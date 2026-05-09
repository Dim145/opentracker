/**
 * GET /api/mod/torrents/pending
 *
 * Moderation queue. Returns every torrent whose status isn't
 * `accepted` — i.e. pending, changes_requested, and rejected — so a
 * moderator sees the full backlog (including rejects, which are kept
 * around to block re-uploads and as a paper trail).
 *
 * Optional `?status=` query restricts the listing to a single bucket
 * when the moderator wants to focus on a specific lane.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { and, desc, eq, ne } from 'drizzle-orm';

const ALLOWED_STATUSES = ['pending', 'changes_requested', 'rejected'] as const;

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const query = getQuery(event);
  const status =
    typeof query.status === 'string' &&
    (ALLOWED_STATUSES as readonly string[]).includes(query.status)
      ? (query.status as (typeof ALLOWED_STATUSES)[number])
      : null;

  const pendingTorrents = await db.query.torrents.findMany({
    where: status
      ? eq(schema.torrents.moderationStatus, status)
      : ne(schema.torrents.moderationStatus, 'accepted'),
    with: {
      uploader: {
        columns: {
          id: true,
          username: true,
        },
      },
      category: true,
      moderatedBy: {
        columns: { id: true, username: true },
      },
    },
    orderBy: [desc(schema.torrents.createdAt)],
  });

  return pendingTorrents;
});
