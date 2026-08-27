/**
 * DELETE /api/mod/federation/masks/:id — lift a mask.
 *
 * The hidden content reappears on the next read. Nothing was ever deleted from
 * the mirror, so there is nothing to restore — the mask simply stops applying.
 */
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { unmaskRemote } from '~~/utils/federation/remoteMask';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing mask id' });

  const removed = await unmaskRemote(id);
  if (!removed) throw createError({ statusCode: 404, message: 'Mask not found' });
  return { ok: true };
});
