/**
 * GET /api/me/reports
 *
 * Personal report log — the rows the *current user* filed, plus
 * whatever resolution a moderator stamped on them. Same shape as
 * `/api/admin/reports` (so the FE can reuse the row component once
 * we factor it out) but scoped to `reporterId = session.user.id`.
 *
 * Query: `?status=pending|resolved|dismissed`, `?page=N`, `?limit=N`.
 *
 * The `resolver` field is intentionally exposed: a reporter has a
 * reasonable expectation to see which staffer acted on their flag,
 * mirroring how the moderation thread on a torrent reveals the
 * moderator who reviewed it.
 */
import { db, schema } from '@trackarr/db';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  const query = getQuery(event);
  const status = query.status as string | undefined;
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 25, 50);
  const offset = (page - 1) * limit;

  const conditions = [eq(schema.reports.reporterId, user.id)];
  if (status && ['pending', 'resolved', 'dismissed'].includes(status)) {
    conditions.push(eq(schema.reports.status, status));
  }
  const whereClause = and(...conditions);

  const [reports, countResult, statusCounts] = await Promise.all([
    db.query.reports.findMany({
      where: whereClause,
      with: {
        resolver: { columns: { id: true, username: true } },
      },
      orderBy: [desc(schema.reports.createdAt)],
      limit,
      offset,
    }),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.reports)
      .where(whereClause),
    // Per-status counts across **all** of the user's reports (not
    // filtered by the active status param). Lets the page render
    // the filter chips with live totals — "Pending 4 / Resolved 8 / …".
    db
      .select({
        status: schema.reports.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.reports)
      .where(eq(schema.reports.reporterId, user.id))
      .groupBy(schema.reports.status),
  ]);

  // Target enrichment — batched per kind so a 50-row page only
  // issues two extra queries.
  const torrentIds = reports
    .filter((r) => r.targetType === 'torrent')
    .map((r) => r.targetId);
  const userIds = reports
    .filter((r) => r.targetType === 'user')
    .map((r) => r.targetId);

  const [torrents, users] = await Promise.all([
    torrentIds.length
      ? db.query.torrents.findMany({
          where: inArray(schema.torrents.id, torrentIds),
          columns: { id: true, infoHash: true, name: true },
        })
      : Promise.resolve([] as { id: string; infoHash: string; name: string }[]),
    userIds.length
      ? db.query.users.findMany({
          where: inArray(schema.users.id, userIds),
          columns: { id: true, username: true },
        })
      : Promise.resolve([] as { id: string; username: string }[]),
  ]);

  const torrentMap = new Map(torrents.map((t) => [t.id, t]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  const enriched = reports.map((r) => {
    let target:
      | { kind: 'torrent'; name: string; link: string }
      | { kind: 'user'; name: string; link: string }
      | { kind: 'post' | 'comment'; name: string; link: null }
      | null = null;

    switch (r.targetType) {
      case 'torrent': {
        const t = torrentMap.get(r.targetId);
        if (t) {
          target = { kind: 'torrent', name: t.name, link: `/torrents/${t.infoHash}` };
        }
        break;
      }
      case 'user': {
        const u = userMap.get(r.targetId);
        if (u) {
          target = { kind: 'user', name: u.username, link: `/users/${u.id}` };
        }
        break;
      }
      case 'post':
      case 'comment': {
        // No URL we can build without a deeper fetch chain, but the
        // user still wants to see the *kind* of content they flagged.
        target = {
          kind: r.targetType as 'post' | 'comment',
          name: r.targetId.slice(0, 8) + '…',
          link: null,
        };
        break;
      }
    }
    return { ...r, target };
  });

  const counts = { pending: 0, resolved: 0, dismissed: 0 };
  for (const row of statusCounts) {
    if (row.status in counts) {
      counts[row.status as keyof typeof counts] = row.count;
    }
  }
  const total = counts.pending + counts.resolved + counts.dismissed;

  return {
    data: enriched,
    counts: { ...counts, all: total },
    pagination: {
      page,
      limit,
      total: countResult[0]?.count || 0,
      pages: Math.ceil((countResult[0]?.count || 0) / limit),
    },
  };
});
