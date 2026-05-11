/**
 * GET /api/admin/reports
 *
 * Paginated list of moderation reports. Available to moderators AND
 * admins (the route still lives under /admin but enforces the wider
 * `requireModeratorSession` gate).
 *
 * Each row is enriched with a `target` object that gives the UI
 * everything it needs to render a clickable reference to the reported
 * entity (currently: torrents and users — posts and comments are
 * surfaced as untyped refs for now). The enrichment is batched per
 * target type so the handler stays O(1) regardless of page size.
 */
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { eq, desc, and, sql, inArray } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);

  const query = getQuery(event);
  const status = query.status as string | undefined;
  const page = parseInt(query.page as string) || 1;
  const limit = Math.min(parseInt(query.limit as string) || 20, 50);
  const offset = (page - 1) * limit;

  const conditions = [];
  if (status && ['pending', 'resolved', 'dismissed'].includes(status)) {
    conditions.push(eq(schema.reports.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [reports, countResult, statusCounts] = await Promise.all([
    db.query.reports.findMany({
      where: whereClause,
      with: {
        reporter: { columns: { id: true, username: true } },
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
    // Snapshot of unfiltered counts per status. Lets the UI render
    // the filter chips with live totals so a mod can see at a glance
    // how much work is pending without flipping through tabs.
    db
      .select({
        status: schema.reports.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.reports)
      .groupBy(schema.reports.status),
  ]);

  // ── Target enrichment ──────────────────────────────────────
  // Group target ids by type so we can fan out one query per type
  // (each capped to ~50 rows by the page limit upstream).
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
      | null = null;

    switch (r.targetType) {
      case 'torrent': {
        const t = torrentMap.get(r.targetId);
        if (t) {
          target = {
            kind: 'torrent',
            name: t.name,
            link: `/torrents/${t.infoHash}`,
          };
        }
        break;
      }
      case 'user': {
        const u = userMap.get(r.targetId);
        if (u) {
          target = {
            kind: 'user',
            name: u.username,
            link: `/users/${u.id}`,
          };
        }
        break;
      }
      // posts/comments left as un-resolved refs — the row still
      // surfaces targetType + targetId so a mod can investigate
      // manually via the DB or a deep link.
    }
    return { ...r, target };
  });

  // Roll the grouped count rows up into a typed object so the UI
  // doesn't have to .find() on every render.
  const counts = {
    pending: 0,
    resolved: 0,
    dismissed: 0,
  };
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
