import { db } from '@trackarr/db';
import { roles } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { reevaluateAllUsers } from '~~/utils/roleRules';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const conditionSchema = z.object({
  field: z.enum([
    'approvedUploads',
    'totalUploads',
    'ratio',
    'uploadedBytes',
    'downloadedBytes',
    'accountAgeDays',
    'hnrCount',
    'completedSeeds',
  ]),
  comparator: z.enum(['gte', 'gt', 'lte', 'lt', 'eq']),
  value: z.number().finite(),
});

const ruleSetSchema = z.object({
  combinator: z.enum(['and', 'or']),
  conditions: z.array(conditionSchema).max(20),
});

// PATCH semantics — every field is optional, an omitted key keeps
// the previous value rather than nulling it.
const bodySchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex (#rrggbb)')
    .optional(),
  icon: z.string().max(64).nullable().optional(),
  showAsBadge: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  assignmentMode: z.enum(['manual', 'auto']).optional(),
  rules: ruleSetSchema.nullable().optional(),
  canUploadWithoutModeration: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Role ID is required' });
  }

  const body = await validateBody(event, bodySchema);

  if (Object.keys(body).length === 0) {
    throw createError({ statusCode: 400, message: 'No fields to update' });
  }

  // Same auto-without-rules guard as POST — protects against a PATCH
  // that switches `assignmentMode: 'auto'` while leaving rules empty.
  const next: Record<string, unknown> = { ...body };
  if (next.assignmentMode === 'auto') {
    const targetRules = (next.rules ?? undefined) as
      | z.infer<typeof ruleSetSchema>
      | null
      | undefined;
    if (targetRules === undefined) {
      // Caller didn't touch `rules`; check the stored row.
      const [existing] = await db
        .select({ rules: roles.rules })
        .from(roles)
        .where(eq(roles.id, id))
        .limit(1);
      const stored = existing?.rules as z.infer<typeof ruleSetSchema> | null;
      if (!stored || stored.conditions.length === 0) {
        throw createError({
          statusCode: 400,
          message:
            'Switching to auto requires at least one condition; add a rule first.',
        });
      }
    } else if (!targetRules || targetRules.conditions.length === 0) {
      throw createError({
        statusCode: 400,
        message:
          'Auto roles need at least one condition; switch to manual or add a rule.',
      });
    }
  }

  const [updated] = await db
    .update(roles)
    .set(next)
    .where(eq(roles.id, id))
    .returning();

  if (!updated) {
    throw createError({ statusCode: 404, message: 'Role not found' });
  }

  // Any change to an auto role's eligibility surface (mode, rules,
  // priority) can flip user assignments. Trigger a sweep — fire-and-
  // forget so the admin doesn't wait on it.
  const eligibilityChanged =
    body.assignmentMode !== undefined ||
    body.rules !== undefined ||
    body.priority !== undefined;
  if (eligibilityChanged) {
    void reevaluateAllUsers().catch((err) => {
      console.error('[Roles] post-edit sweep failed:', err);
    });
  }

  return updated;
});
