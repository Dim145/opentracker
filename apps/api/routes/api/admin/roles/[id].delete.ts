import { db } from '@trackarr/db';
import { roles } from '@trackarr/db/schema';
import { requireAdminSession } from '~~/utils/adminAuth';
import { themesRequiringRole } from '~~/utils/themes';
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

  // A theme reserved to this role would be left gated on nobody: `jsonb` takes
  // no foreign key, and the CHECK counts the array's length rather than
  // resolving its ids. Refused rather than repaired, the same way a font in use
  // is — see `themesRequiringRole`.
  const gated = await themesRequiringRole(id);
  if (gated.length) {
    throw createError({
      statusCode: 409,
      message: `Still required by ${gated.length === 1 ? 'a theme' : 'themes'}: ${gated.join(
        ', ',
      )}. Change what they are available to first.`,
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
