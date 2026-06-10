/**
 * GET /api/mod/anti-cheat/flags
 *
 * Anti-cheat audit log for the moderation team. Returns the flags
 * the Go tracker wrote when it spotted statistical / signature
 * anomalies on an announce (impossible upload velocity, claimed
 * upload to an empty swarm, unknown peer_id prefix). Nothing here
 * triggers actions — the table is purely informational; the page
 * uses this listing to surface candidates for manual review.
 *
 * Query params:
 *   - `status` : `unreviewed` (default) | `reviewed` | `all`
 *   - `kind`   : optional facet filter — velocity | no_leecher | unknown_client
 *   - `userId` : optional, narrow to a single user's flags (the
 *                "drill into a suspect" path from the page)
 *   - `page`   : 1-indexed
 *   - `limit`  : page size, capped at 100
 *
 * Each row is enriched with the user (id + username), torrent name
 * (when the row points at one), and the reviewer (when it's been
 * actioned) so the page never has to issue per-row lookups.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { and, desc, eq, isNotNull, isNull, sql, inArray } from 'drizzle-orm';

const ALLOWED_KINDS = ['velocity', 'no_leecher', 'unknown_client'] as const;

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const query = getQuery(event);
  const status =
    query.status === 'reviewed' || query.status === 'all'
      ? (query.status as 'reviewed' | 'all')
      : 'unreviewed';
  const kind =
    typeof query.kind === 'string' &&
    (ALLOWED_KINDS as readonly string[]).includes(query.kind)
      ? (query.kind as (typeof ALLOWED_KINDS)[number])
      : null;
  const userId =
    typeof query.userId === 'string' && query.userId.length > 0
      ? query.userId
      : null;
  const page = Math.max(1, parseInt(query.page as string) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit as string) || 25));
  const offset = (page - 1) * limit;

  const filters = [];
  if (status === 'unreviewed') filters.push(isNull(schema.anticheatFlags.reviewedAt));
  if (status === 'reviewed') filters.push(isNotNull(schema.anticheatFlags.reviewedAt));
  if (kind) filters.push(eq(schema.anticheatFlags.kind, kind));
  if (userId) filters.push(eq(schema.anticheatFlags.userId, userId));
  const whereClause = filters.length > 0 ? and(...filters) : undefined;

  const [rows, countResult, statusBuckets] = await Promise.all([
    db.query.anticheatFlags.findMany({
      where: whereClause,
      // `id` tiebreaker so rows sharing a createdAt timestamp keep a stable
      // order across pages — without it a moderator can miss or double-see
      // flags on timestamp collisions (finding L22).
      orderBy: [desc(schema.anticheatFlags.createdAt), desc(schema.anticheatFlags.id)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.anticheatFlags)
      .where(whereClause),
    // Per-status totals for the page's tab badges. Independent of
    // the active filters so the unread count stays honest even
    // when the user is drilled into one kind.
    db
      .select({
        unreviewed: sql<number>`count(*) FILTER (WHERE reviewed_at IS NULL)::int`,
        reviewed: sql<number>`count(*) FILTER (WHERE reviewed_at IS NOT NULL)::int`,
        velocity: sql<number>`count(*) FILTER (WHERE kind = 'velocity' AND reviewed_at IS NULL)::int`,
        noLeecher: sql<number>`count(*) FILTER (WHERE kind = 'no_leecher' AND reviewed_at IS NULL)::int`,
        unknownClient: sql<number>`count(*) FILTER (WHERE kind = 'unknown_client' AND reviewed_at IS NULL)::int`,
      })
      .from(schema.anticheatFlags),
  ]);

  // Batch-enrich with user, torrent, reviewer rows in three IN
  // queries — keeps the page-load cost flat at O(1) DB round-trips
  // regardless of the page size.
  const userIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.userId, r.reviewedById].filter((v): v is string => !!v),
      ),
    ),
  );
  const torrentIds = Array.from(
    new Set(rows.map((r) => r.torrentId).filter((v): v is string => !!v)),
  );

  const [users, torrents] = await Promise.all([
    userIds.length
      ? db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, username: true },
        })
      : Promise.resolve([] as { id: string; username: string }[]),
    torrentIds.length
      ? db.query.torrents.findMany({
          where: inArray(schema.torrents.id, torrentIds),
          columns: { id: true, name: true, infoHash: true },
        })
      : Promise.resolve(
          [] as { id: string; name: string; infoHash: string }[],
        ),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const torrentMap = new Map(torrents.map((t) => [t.id, t]));

  const data = rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    details: r.details,
    peerId: r.peerId,
    ip: r.ip,
    userAgent: r.userAgent,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    reviewVerdict: r.reviewVerdict,
    reviewNote: r.reviewNote,
    infoHash: r.infoHash,
    user: userMap.get(r.userId) ?? null,
    torrent: r.torrentId ? torrentMap.get(r.torrentId) ?? null : null,
    reviewer: r.reviewedById ? userMap.get(r.reviewedById) ?? null : null,
  }));

  const total = countResult[0]?.count ?? 0;
  const counts = statusBuckets[0] ?? {
    unreviewed: 0,
    reviewed: 0,
    velocity: 0,
    noLeecher: 0,
    unknownClient: 0,
  };

  return {
    data,
    counts,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  };
});
