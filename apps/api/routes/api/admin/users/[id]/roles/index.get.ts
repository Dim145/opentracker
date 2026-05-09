/**
 * GET /api/admin/users/:id/roles
 *
 * Lists every role currently attached to the user with the metadata
 * the admin "manage roles" dialog needs:
 *   - assignedAt   — when it landed, used in the row tooltip
 *   - assignedManually — drives the "manual" / "auto" chip
 *   - the role's display fields (name / color / icon / mode / etc.)
 *
 * Returns an empty array if the user exists but has no roles. 404
 * only when the user id is unknown.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { eq, asc } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const [user] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!user) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // Inner-join through user_roles so a single round-trip carries both
  // the per-attachment metadata and the role's display fields.
  const rows = await db
    .select({
      roleId: schema.userRoles.roleId,
      assignedAt: schema.userRoles.assignedAt,
      assignedManually: schema.userRoles.assignedManually,
      role: {
        id: schema.roles.id,
        name: schema.roles.name,
        color: schema.roles.color,
        icon: schema.roles.icon,
        priority: schema.roles.priority,
        assignmentMode: schema.roles.assignmentMode,
        showAsBadge: schema.roles.showAsBadge,
        canUploadWithoutModeration: schema.roles.canUploadWithoutModeration,
      },
    })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, id))
    .orderBy(asc(schema.roles.name));

  return rows;
});
