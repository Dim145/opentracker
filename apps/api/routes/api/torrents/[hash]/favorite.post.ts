/**
 * POST /api/torrents/:hash/favorite
 *
 * Pin a torrent to the caller's private favorites. Idempotent —
 * a second POST is a no-op rather than a 409: the UI's star
 * toggle should never need to know about prior state, and a
 * race between two tabs flipping the same row resolves cleanly.
 *
 * No notification to the uploader. Favorites are strictly
 * private, and surfacing "X starred your upload" would tilt the
 * feature into a popularity contest the tracker doesn't need.
 */
import { db } from '@trackarr/db';
import { torrentFavorites } from '@trackarr/db/schema';
import { assertVisibleTorrent } from '~~/utils/torrentListing';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateParam, infoHashSchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const hash = validateParam(event, 'hash', infoHashSchema);

  // The listing's visibility, not mere existence: knowing an info hash was
  // enough to favorite a pending, inactive or adult-hidden torrent — and then
  // read its name, size and ids back from the favorites page.
  const torrent = await assertVisibleTorrent(hash.toLowerCase(), session.user);

  await db
    .insert(torrentFavorites)
    .values({
      userId: session.user.id,
      torrentId: torrent.id,
    })
    .onConflictDoNothing();

  return { favorited: true };
});
