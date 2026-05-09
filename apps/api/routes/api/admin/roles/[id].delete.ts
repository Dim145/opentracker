import { db } from '@trackarr/db';
import { roles } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { eq } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const id = getRouterParam(event, 'id');

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Role ID is required',
    });
  }

  // user_roles has ON DELETE CASCADE on roleId, so all attachments
  // disappear with the role row itself — no manual cleanup needed
  // anymore.
  const [deletedRole] = await db
    .delete(roles)
    .where(eq(roles.id, id))
    .returning();

  if (!deletedRole) {
    throw createError({
      statusCode: 404,
      message: 'Role not found',
    });
  }

  return { success: true, deleted: deletedRole };
});
