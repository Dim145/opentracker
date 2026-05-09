import { db } from '@trackarr/db';
import { roles } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { reevaluateAllUsers } from '~~/utils/roleRules';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// Same RuleSet shape evaluated by apps/api/utils/roleRules.ts. Kept
// schema-side so the admin form's payload is rejected at the edge if
// the operator (or a custom client) sends a malformed tree — the
// evaluator stays defensive but doesn't have to second-guess types.
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

const bodySchema = z.object({
  name: z.string().trim().min(1).max(50),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a 6-digit hex (#rrggbb)')
    .default('#6b7280'),
  icon: z.string().max(64).nullable().optional(),
  showAsBadge: z.boolean().default(false),
  priority: z.number().int().min(0).max(1000).default(0),
  assignmentMode: z.enum(['manual', 'auto']).default('manual'),
  rules: ruleSetSchema.nullable().optional(),
  canUploadWithoutModeration: z.boolean().default(false),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const body = await validateBody(event, bodySchema);
  const id = randomUUID();

  // Auto roles MUST carry a non-empty rules tree, otherwise the engine
  // will silently skip them. Reject the create so the operator sees
  // the issue immediately rather than wondering why the role doesn't
  // attach to anyone.
  if (
    body.assignmentMode === 'auto' &&
    (!body.rules || body.rules.conditions.length === 0)
  ) {
    throw createError({
      statusCode: 400,
      message:
        'Auto roles need at least one condition; switch to manual or add a rule.',
    });
  }

  const [created] = await db
    .insert(roles)
    .values({
      id,
      name: body.name,
      color: body.color,
      icon: body.icon ?? null,
      showAsBadge: body.showAsBadge,
      priority: body.priority,
      assignmentMode: body.assignmentMode,
      rules: body.rules ?? null,
      canUploadWithoutModeration: body.canUploadWithoutModeration,
    })
    .returning();

  // A new auto role can immediately match users — schedule a sweep
  // so they pick it up on the next request rather than at the next
  // 30min cron tick.
  if (body.assignmentMode === 'auto') {
    // Fire-and-forget: don't make the admin wait on the sweep.
    void reevaluateAllUsers().catch((err) => {
      console.error('[Roles] post-create sweep failed:', err);
    });
  }

  return created;
});
