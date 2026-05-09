/**
 * PUT /api/admin/users/:id/assign-role
 * Assign or clear a custom role on a user.
 *
 * Validates that the target role actually exists before writing — the
 * previous version trusted any string from the body, leaving orphan
 * references possible if the schema's FK is ever relaxed.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import { eq } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    roleId: z.string().uuid().nullable(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await validateBody(event, bodySchema);

  if (body.roleId !== null) {
    const role = await db.query.roles.findFirst({
      where: eq(schema.roles.id, body.roleId),
      columns: { id: true },
    });
    if (!role) {
      throw createError({ statusCode: 400, message: 'Invalid role' });
    }
  }

  const [updatedUser] = await db
    .update(schema.users)
    .set({ roleId: body.roleId })
    .where(eq(schema.users.id, id))
    .returning({
      id: schema.users.id,
      username: schema.users.username,
      roleId: schema.users.roleId,
    });

  if (!updatedUser) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  return updatedUser;
});
