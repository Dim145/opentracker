/**
 * POST /api/admin/users/:id/roles
 * Body: { roleId: string }
 *
 * Manually attach a role to a user. The row carries
 * `assignedManually = true` so the auto engine treats it as frozen
 * (it'll never be detached on a sweep, even if the user no longer
 * matches the role's rules).
 *
 * If the role is already attached we simply flip the manual flag on
 * the existing row — the operator's intent ("I want this user to
 * have this role and the engine to keep its hands off") matches the
 * same end state regardless of whether the engine had attached it
 * automatically before.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { invalidateBypassCache } from '~~/utils/torrentModeration';
import { validateBody } from '~~/utils/schemas';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z.object({
  roleId: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await validateBody(event, bodySchema);

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.id, body.roleId))
    .limit(1);
  if (!role) {
    throw createError({ statusCode: 400, message: 'Invalid role' });
  }

  // INSERT…ON CONFLICT lets us upgrade an auto-attached row to a
  // manual freeze without first deleting it (preserves assignedAt).
  const [row] = await db
    .insert(schema.userRoles)
    .values({
      userId: id,
      roleId: body.roleId,
      assignedManually: true,
    })
    .onConflictDoUpdate({
      target: [schema.userRoles.userId, schema.userRoles.roleId],
      set: { assignedManually: true },
    })
    .returning();

  // Role attachment may have flipped the user's
  // `canUploadWithoutModeration` status — invalidate the cached
  // bypass flag so the next upload sees the new value.
  await invalidateBypassCache(id);

  return row;
});
