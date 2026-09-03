/**
 * POST /api/torrents/:hash/reseed-request
 *
 * Ask the people who once downloaded this release to put it back online.
 *
 * A torrent at zero seeders is, today, a silent dead end: the page shows a
 * zero and nothing follows from it. Yet the site knows exactly who could fix
 * it — `hnr_tracking` holds one row per (member, torrent) forever, written both
 * by the tracker on first completion and by the API the moment somebody clicks
 * download. Turning that into a notification is a handful of lines against a
 * measurable effect on catalogue health, which is why this is worth having and
 * a "dead torrents" report is not.
 *
 * ## Guards, in the order they matter
 *
 *   - **Zero seeders, checked live.** A request against a healthy swarm is
 *     noise sent to strangers. The count comes from Redis, the same source the
 *     page the member is looking at used.
 *   - **One request per torrent per day, site-wide.** Not per member: the
 *     recipients are what needs protecting, and ten members each asking once is
 *     ten notifications for one problem. The lock is a Redis key with a TTL —
 *     no column, no sweep, and it expires by itself.
 *   - **A cap on recipients.** An ancient release with 20 000 snatchers would
 *     otherwise be a mass-mail button available to every member.
 *
 * ## Who is NOT notified
 *
 * The requester (they know), erased accounts (a tombstone has no inbox), and
 * banned accounts. `hideDownloadHistory` members ARE notified: the preference
 * governs who can enumerate their snatch list, and a notification about one
 * torrent they downloaded does not enumerate anything — but it does tell them
 * the site remembers, which is why the guide says so plainly.
 */
import { and, desc, eq, isNull, ne } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { getStats, redis } from '~~/utils/server';
import { notify } from '~~/utils/notify';
import { FANOUT_CONCURRENCY, withConcurrency } from '~~/utils/fanout';

/** One request per torrent per day. */
const COOLDOWN_S = 24 * 60 * 60;
const cooldownKey = (torrentId: string) => `reseed:asked:${torrentId}`;

/**
 * How many past snatchers one request may reach.
 *
 * The people most likely to still hold the files are the most recent ones, so
 * the cap takes the newest rows rather than an arbitrary slice.
 */
const MAX_RECIPIENTS = 200;

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const hash = getRouterParam(event, 'hash');
  if (!hash) {
    throw createError({ statusCode: 400, message: 'Torrent hash is required' });
  }
  const infoHash = hash.toLowerCase();

  const torrent = await db.query.torrents.findFirst({
    where: eq(schema.torrents.infoHash, infoHash),
    columns: {
      id: true,
      name: true,
      isActive: true,
      moderationStatus: true,
      supersededById: true,
    },
  });
  if (!torrent || !torrent.isActive || torrent.moderationStatus !== 'accepted') {
    throw createError({ statusCode: 404, message: 'Torrent not found' });
  }

  // A superseded release is meant to fade. Asking members to resurrect one
  // works against the decision a moderator already took.
  if (torrent.supersededById) {
    throw createError({
      statusCode: 400,
      message:
        'This release has been superseded. Ask for the replacement to be seeded instead.',
    });
  }

  const stats = await getStats(infoHash);
  if (stats.seeders > 0) {
    throw createError({
      statusCode: 400,
      message: 'This torrent still has seeders.',
    });
  }

  // Claim the day's slot before doing any work. `SET NX` is atomic, so two
  // members pressing the button at the same instant produce one notification
  // round, not two.
  const claimed = await redis.set(cooldownKey(torrent.id), '1', 'EX', COOLDOWN_S, 'NX');
  if (claimed !== 'OK') {
    throw createError({
      statusCode: 429,
      message: 'A reseed has already been requested for this torrent today.',
    });
  }

  const snatchers = await db
    .select({ userId: schema.hnrTracking.userId })
    .from(schema.hnrTracking)
    .innerJoin(schema.users, eq(schema.users.id, schema.hnrTracking.userId))
    .where(
      and(
        eq(schema.hnrTracking.torrentId, torrent.id),
        ne(schema.hnrTracking.userId, user.id),
        // A tombstone has no inbox, and a banned member cannot act on it.
        isNull(schema.users.deletedAt),
        eq(schema.users.isBanned, false)
      )
    )
    // Newest first, which is what the note above says and what the feature is
      // for: ascending pinged the 200 people who grabbed it longest ago — the
      // least likely to still hold the data — and the daily lock meant nobody
      // could try again that day.
      .orderBy(desc(schema.hnrTracking.downloadedAt))
    .limit(MAX_RECIPIENTS);

  const recipients = snatchers.map((r) => r.userId);

  // Fire-and-forget, after the response: the member pressed a button and does
  // not need to wait on 200 notification inserts to learn that it worked.
  void withConcurrency(recipients, FANOUT_CONCURRENCY, async (userId) => {
    await notify(
      userId,
      'reseed_requested',
      { torrentName: torrent.name, requesterUsername: user.username },
      `/torrents/${infoHash}`
    );
  });

  return { success: true, notified: recipients.length };
});
