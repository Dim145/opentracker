/**
 * DELETE /api/admin/fonts/:id
 *
 * Refuses while a theme still names the face, and says which themes. There is no
 * foreign key to do this — a token holds `upload:<id>` as a string, deliberately,
 * for the same reason `users.theme` has none — so this route is what notices.
 *
 * Refusing rather than cascading is the right way round here. Clearing the token
 * would silently change how a theme looks; telling the owner which themes to fix
 * first leaves the decision with the person who made it.
 */
import { z } from 'zod';
import { requireOwnerSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { deleteFont, themesUsingFont } from '~~/utils/fonts';
import { bumpThemeVersion } from '~~/utils/themes';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireOwnerSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const inUse = await themesUsingFont(id);
  if (inUse.length) {
    throw createError({
      statusCode: 409,
      message: `Still used by ${inUse.length === 1 ? 'a theme' : 'themes'}: ${inUse.join(
        ', ',
      )}. Change those first.`,
      data: { themes: inUse },
    });
  }

  if (!(await deleteFont(id))) {
    throw createError({ statusCode: 404, message: 'No such font' });
  }
  // Nothing references it, so the stylesheet does not change — but the version
  // is what an operator will look at to confirm the write happened.
  await bumpThemeVersion();
  return { ok: true };
});
