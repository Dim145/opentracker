/**
 * DELETE /api/admin/users/:id/roles/:roleId
 *
 * Detach a role from a user. Works for both manual and auto rows —
 * but if the role is auto and the user still matches its rules the
 * next sweep will reattach it. To prevent that the admin should
 * tweak the role's rules instead.
 *
 * After the delete we trigger an immediate re-eval so any *other*
 * auto role that became eligible gets attached without waiting for
 * the 30-min sweep. (Edge case: detaching role A might make the user
 * "exit" the bucket of role A, which doesn't change anything for
 * other roles — but this is cheap insurance.)
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { reevaluateUserRole } from '~~/utils/roleRules';
import { invalidateBypassCache } from '~~/utils/torrentModeration';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
});

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const { id, roleId } = paramsSchema.parse(getRouterParams(event));

  const [removed] = await db
    .delete(schema.userRoles)
    .where(
      and(
        eq(schema.userRoles.userId, id),
        eq(schema.userRoles.roleId, roleId)
      )!
    )
    .returning();

  if (!removed) {
    throw createError({
      statusCode: 404,
      message: 'Role is not attached to this user',
    });
  }

  // Fire-and-forget re-eval to pick up any other rule transitions.
  void reevaluateUserRole(id).catch((err) => {
    console.error('[Roles] post-detach sweep failed:', err);
  });

  // The detached role may have carried `canUploadWithoutModeration`;
  // invalidate the cached bypass flag so the next upload re-checks.
  await invalidateBypassCache(id);

  return { success: true };
});
