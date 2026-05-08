/**
 * PUT /api/admin/users/:id/role
 * Toggle isAdmin / isModerator flags on a user.
 *
 * Hardening:
 *   - Strict Zod body — `!!body.isAdmin` used to coerce strings, so
 *     `{isAdmin: "false"}` flipped the bit to true.
 *   - Last-admin guard — refuse to demote the only remaining admin
 *     (would lock the install out of admin recovery).
 *   - Self-demote guard — an admin can't strip their own admin bit
 *     mid-session; they must ask another admin.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { eq, and, ne, count } from 'drizzle-orm';
import { z } from 'zod';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    isAdmin: z.boolean(),
    isModerator: z.boolean(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireAdminSession(event);
  const { id } = paramsSchema.parse(getRouterParams(event));
  const body = await readValidatedBody(event, bodySchema.parse);

  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: { id: true, isAdmin: true, isModerator: true },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // Self-demote guard — an admin can't lose their own admin bit via
  // this route. Forces a "two admin" workflow for demotions.
  if (actor.id === target.id && target.isAdmin && !body.isAdmin) {
    throw createError({
      statusCode: 400,
      message: 'You cannot remove your own admin status. Ask another admin.',
    });
  }

  // Last-admin guard — count *other* admins. Prevents an empty admin
  // pool that would block recovery short of a panic restore.
  if (target.isAdmin && !body.isAdmin) {
    const [{ value: otherAdmins } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.users)
      .where(and(eq(schema.users.isAdmin, true), ne(schema.users.id, target.id)));
    if (otherAdmins === 0) {
      throw createError({
        statusCode: 400,
        message:
          'Cannot demote the last admin. Promote another user to admin first.',
      });
    }
  }

  const [updated] = await db
    .update(schema.users)
    .set({
      isAdmin: body.isAdmin,
      isModerator: body.isModerator,
    })
    .where(eq(schema.users.id, id))
    .returning();

  return updated;
});
