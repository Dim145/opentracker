/**
 * GET /api/stats/traffic
 *
 * Public traffic KPI used on the homepage:
 *
 *   {
 *     totalUploaded: "179933000000000000",  // cumulative SUM(users.uploaded) right now
 *     last24h:       "31000000000000",      // diff vs the snapshot ~24 h old
 *     last7d:        "210000000000000",     // diff vs the snapshot ~7 d old
 *     history: [                            // last ~7 days of hourly snapshots
 *       { at: 1778900000000, totalUploaded: "..." },
 *       …
 *     ],
 *   }
 *
 * Everything is "uploaded only" — in a healthy swarm a byte uploaded
 * by one peer is a byte downloaded by another, so this single
 * counter is the canonical "volume échangé" figure.
 *
 * Sources:
 *   - `totalUploaded`   = `SUM(users.uploaded)` (one row scan; with
 *                          an index on PK it's hundreds of µs).
 *   - `last24h/last7d`  = diff against the closest `site_stats` row
 *                          older than the window. Two cheap queries.
 *   - `history`         = chronological list of `site_stats` rows
 *                          over the same 7-day window — perfect
 *                          source for a sparkline.
 *
 * The whole payload is cached in-memory for 30 s. The collector runs
 * hourly so finer staleness isn't useful, and we don't want a busy
 * homepage to slam Postgres on every refresh.
 *
 * Sent as strings so the FE can `BigInt` past 2^53 bytes (~9 PiB)
 * without precision loss.
 */
import { db, schema } from '@trackarr/db';
import { sql, gte, asc, desc, lte } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

interface TrafficPoint {
  at: number; // unix ms
  totalUploaded: string;
}

interface TrafficResponse {
  totalUploaded: string;
  last24h: string;
  last7d: string;
  history: TrafficPoint[];
  updatedAt: number;
}

const CACHE_TTL_MS = 30_000;
let cached: { value: TrafficResponse; expiresAt: number } | null = null;

async function compute(): Promise<TrafficResponse> {
  const now = Date.now();
  const ago24h = new Date(now - 24 * 60 * 60 * 1000);
  const ago7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // 1. Live cumulative figure straight from users. We subtract
  //    `bonus_uploaded` so the public KPI reflects bytes that
  //    actually transited the swarm — shop `upload_credit`
  //    purchases and the registration starter bonus pad
  //    `users.uploaded` but never carried a real packet.
  const totalRow = await db
    .select({
      total: sql<string>`COALESCE(SUM(${schema.users.uploaded} - ${schema.users.bonusUploaded}), 0)::text`,
    })
    .from(schema.users);
  const totalUploaded = totalRow[0]?.total ?? '0';

  // 2. Closest snapshots before each cutoff. If the tracker is very
  //    young (no snapshot that old) the diff naturally evaluates to
  //    the full cumulative — which is correct: "everything you see
  //    happened in the last 24 h" on a fresh deploy.
  const closestBefore = async (cutoff: Date): Promise<string> => {
    const row = await db
      .select({ total: schema.siteStats.totalUploadedBytes })
      .from(schema.siteStats)
      .where(lte(schema.siteStats.createdAt, cutoff))
      .orderBy(desc(schema.siteStats.createdAt))
      .limit(1);
    return String(row[0]?.total ?? 0);
  };

  const past24h = await closestBefore(ago24h);
  const past7d = await closestBefore(ago7d);

  const diff = (current: string, past: string): string => {
    // BigInt to keep precision past 2^53.
    const d = BigInt(current) - BigInt(past);
    return (d < 0n ? 0n : d).toString();
  };

  // 3. Sparkline source: every snapshot in the last 7 days. We trim
  //    to ~168 points (one per hour) — Chart.js handles it fine.
  const history = await db
    .select({
      at: schema.siteStats.createdAt,
      total: schema.siteStats.totalUploadedBytes,
    })
    .from(schema.siteStats)
    .where(gte(schema.siteStats.createdAt, ago7d))
    .orderBy(asc(schema.siteStats.createdAt));

  return {
    totalUploaded,
    last24h: diff(totalUploaded, past24h),
    last7d: diff(totalUploaded, past7d),
    history: history.map((r) => ({
      at: new Date(r.at).getTime(),
      totalUploaded: String(r.total),
    })),
    updatedAt: now,
  };
}

export default defineEventHandler(async (event): Promise<TrafficResponse> => {
  await rateLimit(event, RATE_LIMITS.public);

  const now = Date.now();
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }
  const value = await compute();
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
});
