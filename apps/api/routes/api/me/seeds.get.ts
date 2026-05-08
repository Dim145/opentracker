/**
 * GET /api/me/seeds
 *
 * Returns the active-seeds view for the logged-in user. "Active" here
 * combines two signals so the page can show meaningful state even when
 * the swarm is sparse:
 *
 *   1. Persistent: hnr_tracking row for (user, torrent) with > 0 seed
 *      time accumulated. The tracker writes to seed_time on every
 *      announce when the user is reporting `event=stopped` or just
 *      ticking, so this is a durable record of "what they've been
 *      seeding".
 *
 *   2. Live: Redis swarm head-count (seeders / leechers) so the UI can
 *      mark whether the swarm currently has anyone in it. We don't have
 *      a per-user "in swarm right now" signal because the tracker stores
 *      peers keyed by info_hash only — adding a user index would mean
 *      Go-side changes. The pragmatic compromise is "user has logged
 *      seed time AND swarm is alive" → currently active.
 *
 * Pagination: default 25, max 100. Filter via `status` query:
 *   - `active` (default): seedTime > 0 OR completedAt set, isHnr false
 *   - `pending`: seedTime > 0 BUT requirement not yet met (still seeding)
 *   - `completed`: completedAt set
 *   - `hnr`: isHnr true (violations)
 *   - `all`: every hnr_tracking row
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { getStats } from '~~/utils/server';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  status: z
    .enum(['active', 'pending', 'completed', 'hnr', 'all'])
    .default('active'),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const params = querySchema.parse(getQuery(event));

  // Build WHERE
  const conditions = [eq(schema.hnrTracking.userId, user.id)];
  switch (params.status) {
    case 'active':
      // Either currently meeting the seed obligation, or already
      // completed it. The exempt flag also counts (operator override).
      conditions.push(
        sql`(${schema.hnrTracking.seedTime} > 0 OR ${schema.hnrTracking.completedAt} IS NOT NULL OR ${schema.hnrTracking.isExempt} = true)`
      );
      conditions.push(eq(schema.hnrTracking.isHnr, false));
      break;
    case 'pending':
      conditions.push(eq(schema.hnrTracking.isHnr, false));
      conditions.push(sql`${schema.hnrTracking.completedAt} IS NULL`);
      break;
    case 'completed':
      conditions.push(sql`${schema.hnrTracking.completedAt} IS NOT NULL`);
      break;
    case 'hnr':
      conditions.push(eq(schema.hnrTracking.isHnr, true));
      break;
    case 'all':
      // no additional clauses
      break;
  }

  const where = and(...conditions);

  const [rows, [{ value: total } = { value: 0 }], [{ value: stats } = { value: {} as any }]] =
    await Promise.all([
      db.query.hnrTracking.findMany({
        where,
        with: {
          torrent: {
            with: { category: true },
          },
        },
        orderBy: [desc(schema.hnrTracking.downloadedAt)],
        limit: params.pageSize,
        offset: (params.page - 1) * params.pageSize,
      }),
      db
        .select({ value: sql<number>`count(*)::int` })
        .from(schema.hnrTracking)
        .where(where),
      // Roll up the per-status counts in one shot so the tab strip can
      // show "Active (12)" / "Pending (3)" / "HnR (1)" without a round-trip
      // per tab.
      db
        .select({
          value: sql<{
            active: number;
            pending: number;
            completed: number;
            hnr: number;
            all: number;
          }>`json_build_object(
            'active', count(*) FILTER (WHERE is_hnr = false AND (seed_time > 0 OR completed_at IS NOT NULL OR is_exempt = true))::int,
            'pending', count(*) FILTER (WHERE is_hnr = false AND completed_at IS NULL)::int,
            'completed', count(*) FILTER (WHERE completed_at IS NOT NULL)::int,
            'hnr', count(*) FILTER (WHERE is_hnr = true)::int,
            'all', count(*)::int
          )`,
        })
        .from(schema.hnrTracking)
        .where(eq(schema.hnrTracking.userId, user.id)),
    ]);

  // Enrich each row with live Redis swarm stats. The Redis call is cheap
  // (single HMGET) so we do it per-row rather than one giant pipeline.
  const enriched = await Promise.all(
    rows.map(async (row) => {
      const live = await getStats(row.torrent.infoHash).catch(() => ({
        seeders: 0,
        leechers: 0,
        completed: 0,
      }));
      return {
        id: row.id,
        infoHash: row.torrent.infoHash,
        name: row.torrent.name,
        size: row.torrent.size,
        category: row.torrent.category
          ? { id: row.torrent.category.id, name: row.torrent.category.name }
          : null,
        downloadedAt: row.downloadedAt,
        completedAt: row.completedAt,
        seedTime: row.seedTime,
        requiredSeedTime: row.requiredSeedTime,
        isHnr: row.isHnr,
        isExempt: row.isExempt,
        seeders: live.seeders,
        leechers: live.leechers,
        completed: live.completed,
      };
    })
  );

  return {
    items: enriched,
    total,
    page: params.page,
    pageSize: params.pageSize,
    counts: stats ?? {
      active: 0,
      pending: 0,
      completed: 0,
      hnr: 0,
      all: 0,
    },
  };
});
