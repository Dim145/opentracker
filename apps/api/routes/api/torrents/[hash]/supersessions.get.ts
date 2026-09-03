/**
 * GET /api/torrents/:hash/supersessions
 *
 * Both directions of the trump pointer for one release: what replaced it, and
 * what it replaced.
 *
 * Its own endpoint rather than fields on the detail payload, for the same
 * reason the cross-seed siblings have one: the detail page fetches it
 * separately and non-blocking, so a torrent with a long supersede chain never
 * delays the page it belongs to. A missing or failing endpoint degrades to a
 * hidden section.
 *
 * Visibility follows the catalogue's: a member sees `accepted` rows only, staff
 * see everything. Without that, the pointer would be a way to learn that a
 * pending or rejected release exists — the same oracle the duplicate preflight
 * is careful not to be.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/** A release can replace several older ones; the list is capped all the same. */
const MAX_SUPERSEDES = 25;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }

  const isStaff = !!user.isAdmin || !!user.isModerator;
  const visible = (alias: typeof schema.torrents) =>
    isStaff ? undefined : eq(alias.moderationStatus, 'accepted');

  const source = await db.query.torrents.findFirst({
    // The visibility filter belongs on the SOURCE too, and its absence made
    // this an existence oracle: a rejected hash answered 200 with empty
    // relations while an unknown hash answered 404, so a member could sort
    // hashes into "moderation turned this down" and "never heard of it". The
    // detail endpoint flat-404s for exactly this reason.
    where: and(eq(schema.torrents.infoHash, hash.toLowerCase()), visible(schema.torrents)),
    columns: {
      id: true,
      supersededById: true,
      supersededAt: true,
      supersedeReason: true,
    },
  });
  if (!source) {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // Forward: the release that replaced this one.
  const supersededBy = source.supersededById
    ? ((await db.query.torrents.findFirst({
        where: and(
          eq(schema.torrents.id, source.supersededById),
          visible(schema.torrents)
        ),
        columns: { infoHash: true, name: true, size: true, createdAt: true },
      })) ?? null)
    : null;

  // Reverse: the releases this one replaced. Served by
  // `torrents_superseded_by_idx`.
  const supersedes = await db.query.torrents.findMany({
    where: and(
      eq(schema.torrents.supersededById, source.id),
      visible(schema.torrents)
    ),
    columns: {
      infoHash: true,
      name: true,
      size: true,
      supersededAt: true,
      supersedeReason: true,
    },
    limit: MAX_SUPERSEDES,
  });

  return {
    supersededBy: supersededBy
      ? {
          ...supersededBy,
          at: source.supersededAt,
          reason: source.supersedeReason,
        }
      : null,
    supersedes,
  };
});
