/**
 * The numbers a member is allowed to see about the site, and about their own
 * year.
 *
 * ## Why this is not `/api/admin/stats` with a softer gate
 *
 * The operator console answers "is the machine healthy" — Redis memory,
 * database size, per-user request logs. A member asking "how is the site doing"
 * is asking a different question, and most of the answers to the first one are
 * either meaningless to them or nobody's business. So this module computes its
 * own set rather than widening that one, and the difference is not cosmetic: the
 * queries here are written to be cheap enough to serve to everybody, and every
 * one of them is filtered by what the caller is allowed to know.
 *
 * ## What is deliberately absent
 *
 * **No per-member volume.** Uploaded and downloaded bytes are the numbers a
 * tracker's leaderboards are traditionally built on, and there is no setting on
 * this site by which a member could decline to appear in one. A ratio board
 * would therefore publish, for every member, a figure they never agreed to
 * publish. Upload COUNTS are different — a member's uploads are already listed
 * on their profile, so counting them discloses nothing new — and that is what
 * the board here ranks.
 *
 * **No member who uploads anonymously.** `users.anonymous_uploads` conceals a
 * name on every surface that attributes a release. A leaderboard naming them
 * would be the one surface that undoes it, so they are excluded from the board
 * and still counted in the totals.
 *
 * **No adult release to somebody who has not opted in.** The catalogue's rule,
 * applied to every list that names a torrent.
 *
 * ## The shape of the history
 *
 * `site_stats` is an hourly snapshot of cumulative counters. Nothing in it is a
 * per-day figure, so the daily series are derived here: one point per day (the
 * last snapshot of that day), and traffic per day as the difference between
 * consecutive points. Both derivations are pure functions below, because both
 * have a failure mode that a database cannot show you — a gap in the snapshots,
 * and a counter that goes DOWN.
 */
import { and, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { adultCategoryIds } from './adultContent';

// ─────────────────────────────────────────────────────────────────────────────
// Pure shaping
// ─────────────────────────────────────────────────────────────────────────────

export interface Snapshot {
  /** `YYYY-MM-DD`, formatted by Postgres — see `snapshots()`. */
  day: string;
  at: Date;
  users: number;
  torrents: number;
  peers: number;
  seeders: number;
  uploaded: number;
}

export interface DailyPoint {
  /** `YYYY-MM-DD`, UTC. */
  day: string;
  users: number;
  torrents: number;
  peers: number;
  seeders: number;
  /** Cumulative bytes at the end of that day. */
  uploaded: number;
}

/**
 * One point per day: the LAST snapshot of each day, not an average.
 *
 * Averaging would be wrong for cumulative counters — the mean of a rising
 * counter is a value it held at no point — and the last reading of the day is
 * also the one the next day's difference has to be taken against.
 *
 * Days with no snapshot at all are simply absent rather than zero-filled. A
 * restart, or an instance that was down for six hours, must not draw a cliff to
 * zero and back on a chart of a counter that never moved.
 */
export function dailyPoints(rows: Snapshot[]): DailyPoint[] {
  const byDay = new Map<string, Snapshot>();
  for (const row of rows) {
    // The day comes from the query, not from `at.toISOString()`. `created_at` is
    // `timestamp without time zone`, and postgres.js hands a zone-less value to
    // `new Date()`, which reads it in the PROCESS's zone — and the shipped
    // compose file sets `TZ=Europe/Paris`. Bucketing in JavaScript therefore cut
    // the days at 22:00 UTC and labelled them "UTC", which put a New Year's Eve
    // upload in the previous year's review.
    const day = row.day;
    const seen = byDay.get(day);
    if (!seen || row.at > seen.at) byDay.set(day, row);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, s]) => ({
      day,
      users: s.users,
      torrents: s.torrents,
      peers: s.peers,
      seeders: s.seeders,
      uploaded: s.uploaded,
    }));
}

export interface DailyDelta {
  day: string;
  /** Bytes that moved that day. Never negative — see below. */
  bytes: number;
  /** Torrents added that day. Never negative, same reason. */
  torrents: number;
  /** Members who joined that day. */
  users: number;
}

/**
 * Per-day movement, from consecutive cumulative points.
 *
 * A decrease is clamped to zero rather than reported, and that is the whole
 * reason this is a tested function. `total_uploaded_bytes` is
 * `SUM(users.uploaded)`, so **erasing an account lowers it** — as does a
 * moderator zeroing a cheater's stats, or a torrent being deleted. Reporting
 * "-4.2 TB of traffic on Tuesday" would be worse than useless: it is a figure a
 * reader would try to explain.
 *
 * The first day has no predecessor, so it is dropped rather than compared
 * against zero — which would otherwise print the site's entire history as one
 * day's traffic.
 */
/** Whole days between two `YYYY-MM-DD` labels. */
function daysBetween(a: string, b: string): number {
  return Math.round(
    (Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000
  );
}

export function dailyDeltas(points: DailyPoint[]): DailyDelta[] {
  const out: DailyDelta[] = [];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const cur = points[i]!;
    /**
     * A gap in the snapshots is skipped rather than attributed.
     *
     * `dailyPoints` deliberately omits a day with no snapshot, so after an
     * outage from the 3rd to the 7th the 8th's difference covers five days of
     * traffic — and `busiestDay` then names the day after the longest outage as
     * the busiest of the year, every time, with a bar that dwarfs the chart.
     * There is no way to split it honestly, so it is left out.
     */
    if (daysBetween(prev.day, cur.day) !== 1) continue;
    out.push({
      day: cur.day,
      bytes: Math.max(0, cur.uploaded - prev.uploaded),
      torrents: Math.max(0, cur.torrents - prev.torrents),
      users: Math.max(0, cur.users - prev.users),
    });
  }
  return out;
}

/** The busiest day by bytes moved, or null when there is nothing to compare. */
export function busiestDay(deltas: DailyDelta[]): DailyDelta | null {
  let best: DailyDelta | null = null;
  for (const d of deltas) {
    if (d.bytes > 0 && (!best || d.bytes > best.bytes)) best = d;
  }
  return best;
}

/**
 * The half-open UTC window for a calendar year.
 *
 * UTC rather than the instance's local time, deliberately: the members of one
 * tracker are spread across every timezone, so a "year" anchored on the
 * server's own offset would be an arbitrary choice presented as a fact. The
 * boundary is stated in the guide.
 */
export function yearWindow(year: number): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

/**
 * Which years an instance can be asked about: the year of its first snapshot
 * through the current one, newest first.
 *
 * Bounded by data rather than by a constant so the selector cannot offer a year
 * the site did not exist for — an empty review reads like a broken page.
 */
export function selectableYears(firstSeen: Date | null, now: Date): number[] {
  const current = now.getUTCFullYear();
  const first = firstSeen ? firstSeen.getUTCFullYear() : current;
  const out: number[] = [];
  for (let y = current; y >= first; y--) out.push(y);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Queries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The catalogue predicate every list here shares: a release that is live and
 * has been through moderation, minus the adult tree when the caller has not
 * asked for it.
 *
 * One definition, for the same reason `uploaderVisibility` is one definition:
 * five hand-written copies of "what a member may see" will disagree, and the
 * failure mode is a leak rather than a wrong total.
 */
function visibleTorrents(adultIds: string[]) {
  const parts = [
    eq(schema.torrents.isActive, true),
    eq(schema.torrents.moderationStatus, 'accepted'),
  ];
  if (adultIds.length) {
    // `notInArray` on a nullable column is null-safe here only because an
    // uncategorised torrent cannot be in the adult tree: the OR keeps it.
    parts.push(
      sql`(${schema.torrents.categoryId} IS NULL OR ${schema.torrents.categoryId} NOT IN ${adultIds})`
    );
  }
  return and(...parts);
}

/** The adult ids to exclude — empty when the member has opted in. */
export async function hiddenCategoryIds(showAdult: boolean): Promise<string[]> {
  if (showAdult) return [];
  return adultCategoryIds();
}

export interface SiteNow {
  torrents: number;
  members: number;
  seeders: number;
  leechers: number;
  snatches: number;
  /** Bytes catalogued (sum of torrent sizes), and bytes moved (announce deltas). */
  catalogued: number;
  trafficTotal: number;
}

export async function siteNow(adultIds: string[]): Promise<SiteNow> {
  const where = visibleTorrents(adultIds);

  const [counts] = await db
    .select({
      torrents: sql<number>`count(*)::int`,
      catalogued: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
    })
    .from(schema.torrents)
    .where(where);

  const [swarm] = await db
    .select({
      // `sum()` of an integer is a bigint, and `completed` is cumulative: a
      // catalogue past roughly 2.1 billion total completions would have made the
      // `::int` cast throw `integer out of range` and taken the whole page with
      // it. Kept as bigint and narrowed in JS, like the byte figures.
      seeders: sql<number>`coalesce(sum(${schema.torrentStats.seeders}), 0)::bigint`,
      leechers: sql<number>`coalesce(sum(${schema.torrentStats.leechers}), 0)::bigint`,
      snatches: sql<number>`coalesce(sum(${schema.torrentStats.completed}), 0)::bigint`,
    })
    .from(schema.torrentStats)
    .innerJoin(
      schema.torrents,
      eq(schema.torrents.infoHash, schema.torrentStats.infoHash)
    )
    .where(where);

  // Members, not rows: an erased account keeps its row (nothing cascades from
  // `users`), so counting rows would count people who asked to be forgotten.
  const [members] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(isNull(schema.users.deletedAt));

  const [latest] = await db
    .select({ uploaded: schema.siteStats.totalUploadedBytes })
    .from(schema.siteStats)
    .orderBy(desc(schema.siteStats.createdAt))
    .limit(1);

  return {
    torrents: counts?.torrents ?? 0,
    members: members?.n ?? 0,
    seeders: Number(swarm?.seeders ?? 0),
    leechers: Number(swarm?.leechers ?? 0),
    snatches: Number(swarm?.snatches ?? 0),
    catalogued: Number(counts?.catalogued ?? 0),
    trafficTotal: Number(latest?.uploaded ?? 0),
  };
}

/** Raw snapshots for a window, oldest first. */
export async function snapshots(since: Date, until?: Date): Promise<Snapshot[]> {
  const rows = await db
    .select({
      // Formatted by Postgres so the label is the stored (UTC) date rather than
      // whatever zone this process happens to run in.
      day: sql<string>`to_char(${schema.siteStats.createdAt}, 'YYYY-MM-DD')`,
      at: schema.siteStats.createdAt,
      users: schema.siteStats.usersCount,
      torrents: schema.siteStats.torrentsCount,
      peers: schema.siteStats.peersCount,
      seeders: schema.siteStats.seedersCount,
      uploaded: schema.siteStats.totalUploadedBytes,
    })
    .from(schema.siteStats)
    .where(
      until
        ? and(
            gte(schema.siteStats.createdAt, since),
            lt(schema.siteStats.createdAt, until)
          )
        : gte(schema.siteStats.createdAt, since)
    )
    .orderBy(schema.siteStats.createdAt);
  return rows.map((r) => ({ ...r, uploaded: Number(r.uploaded) }));
}

export interface CategorySlice {
  id: string;
  name: string;
  slug: string;
  torrents: number;
  bytes: number;
}

export async function categoryBreakdown(
  adultIds: string[]
): Promise<CategorySlice[]> {
  const rows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      slug: schema.categories.slug,
      torrents: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.torrents.categoryId)
    )
    .where(visibleTorrents(adultIds))
    .groupBy(schema.categories.id, schema.categories.name, schema.categories.slug)
    .orderBy(desc(sql`count(*)`));
  return rows.map((r) => ({ ...r, bytes: Number(r.bytes) }));
}

export interface TopTorrent {
  infoHash: string;
  name: string;
  categoryName: string | null;
  size: number;
  seeders: number;
  snatches: number;
  createdAt: Date;
}

/**
 * Releases ranked by one column, `snatches` or `seeders`.
 *
 * The ordering column is chosen from a closed set rather than interpolated —
 * this is an ORDER BY, which no amount of escaping makes safe from a caller.
 */
export async function topTorrents(
  by: 'snatches' | 'seeders',
  adultIds: string[],
  limit: number
): Promise<TopTorrent[]> {
  const column =
    by === 'snatches' ? schema.torrentStats.completed : schema.torrentStats.seeders;
  const rows = await db
    .select({
      infoHash: schema.torrents.infoHash,
      name: schema.torrents.name,
      categoryName: schema.categories.name,
      size: schema.torrents.size,
      seeders: schema.torrentStats.seeders,
      snatches: schema.torrentStats.completed,
      createdAt: schema.torrents.createdAt,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.torrentStats,
      eq(schema.torrentStats.infoHash, schema.torrents.infoHash)
    )
    .leftJoin(
      schema.categories,
      eq(schema.categories.id, schema.torrents.categoryId)
    )
    .where(and(visibleTorrents(adultIds), sql`${column} > 0`))
    .orderBy(desc(column))
    .limit(limit);
  return rows.map((r) => ({ ...r, size: Number(r.size) }));
}

export interface TopUploader {
  /** The profile page routes on the id, not the name. */
  id: string;
  username: string;
  uploads: number;
}

/**
 * Members ranked by how many live releases they have contributed.
 *
 * Counts, never bytes — see the note at the top of the file — and never a
 * member who uploads anonymously.
 */
export async function topUploaders(
  adultIds: string[],
  limit: number
): Promise<TopUploader[]> {
  const rows = await db
    .select({
      id: schema.users.id,
      username: schema.users.username,
      uploads: sql<number>`count(*)::int`,
    })
    .from(schema.torrents)
    .innerJoin(schema.users, eq(schema.users.id, schema.torrents.uploaderId))
    .where(
      and(
        visibleTorrents(adultIds),
        eq(schema.users.anonymousUploads, false),
        isNull(schema.users.deletedAt),
        // A banned account is not a member of the site any more, and a cheater
        // heading the public board is the worst version of this page.
        eq(schema.users.isBanned, false)
      )
    )
    .groupBy(schema.users.id, schema.users.username)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);
  return rows;
}

export interface YearInReview {
  year: number;
  /** Null until the year has a first snapshot — a year before the site existed. */
  trafficBytes: number | null;
  torrentsAdded: number;
  bytesAdded: number;
  membersJoined: number;
  uploadersActive: number;
  snatches: number;
  busiestDay: DailyDelta | null;
  months: Array<{ month: number; torrents: number; bytes: number }>;
  topCategories: CategorySlice[];
  topReleases: TopTorrent[];
}

export async function siteYear(
  year: number,
  adultIds: string[]
): Promise<YearInReview> {
  const { start, end } = yearWindow(year);
  const inYear = and(
    gte(schema.torrents.createdAt, start),
    lt(schema.torrents.createdAt, end)
  );
  const where = and(visibleTorrents(adultIds), inYear);

  const [added] = await db
    .select({
      torrents: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
      uploaders: sql<number>`count(distinct ${schema.torrents.uploaderId})::int`,
    })
    .from(schema.torrents)
    .where(where);

  const [joined] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.users)
    .where(
      and(
        gte(schema.users.createdAt, start),
        lt(schema.users.createdAt, end),
        isNull(schema.users.deletedAt)
      )
    );

  /**
   * COMPLETIONS dated inside the year, not grabs.
   *
   * `hnr_tracking` is the only dated per-download record — `torrent_stats.completed`
   * is a running total with no date — but a row is written when a member clicks
   * the `.torrent`, before a single byte moves. Counting rows therefore counted
   * downloads of a metainfo file, while the figure beside it in the header counts
   * real completions: two different quantities under one word. `completed_at`
   * is what makes them the same question.
   */
  const [snatched] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.hnrTracking)
    .innerJoin(
      schema.torrents,
      eq(schema.torrents.id, schema.hnrTracking.torrentId)
    )
    .where(
      and(
        visibleTorrents(adultIds),
        sql`${schema.hnrTracking.completedAt} is not null`,
        gte(schema.hnrTracking.completedAt, start),
        lt(schema.hnrTracking.completedAt, end)
      )
    );

  const monthRows = await db
    .select({
      month: sql<number>`extract(month from ${schema.torrents.createdAt})::int`,
      torrents: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
    })
    .from(schema.torrents)
    .where(where)
    .groupBy(sql`extract(month from ${schema.torrents.createdAt})`)
    .orderBy(sql`extract(month from ${schema.torrents.createdAt})`);

  const catRows = await db
    .select({
      id: schema.categories.id,
      name: schema.categories.name,
      slug: schema.categories.slug,
      torrents: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.torrents.categoryId)
    )
    .where(where)
    .groupBy(schema.categories.id, schema.categories.name, schema.categories.slug)
    .orderBy(desc(sql`count(*)`))
    .limit(5);

  const releaseRows = await db
    .select({
      infoHash: schema.torrents.infoHash,
      name: schema.torrents.name,
      categoryName: schema.categories.name,
      size: schema.torrents.size,
      seeders: schema.torrentStats.seeders,
      snatches: schema.torrentStats.completed,
      createdAt: schema.torrents.createdAt,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.torrentStats,
      eq(schema.torrentStats.infoHash, schema.torrents.infoHash)
    )
    .leftJoin(
      schema.categories,
      eq(schema.categories.id, schema.torrents.categoryId)
    )
    .where(where)
    .orderBy(desc(schema.torrentStats.completed))
    .limit(5);

  // Traffic across the year: the difference between the first and last snapshot
  // inside it. Clamped, because the same counter can go down.
  const points = dailyPoints(await snapshots(start, end));
  const deltas = dailyDeltas(points);
  const traffic = points.length >= 2
    ? Math.max(0, points[points.length - 1]!.uploaded - points[0]!.uploaded)
    : null;

  return {
    year,
    trafficBytes: traffic,
    torrentsAdded: added?.torrents ?? 0,
    bytesAdded: Number(added?.bytes ?? 0),
    membersJoined: joined?.n ?? 0,
    uploadersActive: added?.uploaders ?? 0,
    snatches: snatched?.n ?? 0,
    busiestDay: busiestDay(deltas),
    months: monthRows.map((m) => ({ ...m, bytes: Number(m.bytes) })),
    topCategories: catRows.map((c) => ({ ...c, bytes: Number(c.bytes) })),
    topReleases: releaseRows.map((r) => ({ ...r, size: Number(r.size) })),
  };
}

export interface MemberYear {
  year: number;
  uploads: number;
  uploadedBytesCatalogued: number;
  snatches: number;
  seedTimeSeconds: number;
  bytesUp: number;
  bytesDown: number;
  bonusEarned: number;
  invitesUsed: number;
  topCategory: { name: string; torrents: number } | null;
  bestRelease: { infoHash: string; name: string; snatches: number } | null;
}

/**
 * One member's year, for that member only.
 *
 * Their own numbers, so there is nothing to redact — the adult filter is not
 * applied here either, since a member who downloaded something already saw it,
 * and hiding their own history from them would be a lie about their own year.
 */
export async function memberYear(
  userId: string,
  year: number
): Promise<MemberYear> {
  const { start, end } = yearWindow(year);

  const [uploads] = await db
    .select({
      n: sql<number>`count(*)::int`,
      bytes: sql<number>`coalesce(sum(${schema.torrents.size}), 0)::bigint`,
    })
    .from(schema.torrents)
    .where(
      and(
        eq(schema.torrents.uploaderId, userId),
        gte(schema.torrents.createdAt, start),
        lt(schema.torrents.createdAt, end)
      )
    );

  // The hit-and-run ledger doubles as the member's own download record: one row
  // per (member, torrent) grab, with the bytes that actually moved on it.
  const [grabs] = await db
    .select({
      n: sql<number>`count(*)::int`,
      seedTime: sql<number>`coalesce(sum(${schema.hnrTracking.seedTime}), 0)::bigint`,
      up: sql<number>`coalesce(sum(${schema.hnrTracking.uploaded}), 0)::bigint`,
      down: sql<number>`coalesce(sum(${schema.hnrTracking.downloaded}), 0)::bigint`,
    })
    .from(schema.hnrTracking)
    .where(
      and(
        eq(schema.hnrTracking.userId, userId),
        gte(schema.hnrTracking.downloadedAt, start),
        lt(schema.hnrTracking.downloadedAt, end)
      )
    );

  const [bonus] = await db
    .select({
      amount: sql<number>`coalesce(sum(${schema.bonusGrants.amount}), 0)::numeric`,
    })
    .from(schema.bonusGrants)
    .where(
      and(
        eq(schema.bonusGrants.userId, userId),
        gte(schema.bonusGrants.createdAt, start),
        lt(schema.bonusGrants.createdAt, end)
      )
    );

  const [invites] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.invitations)
    .where(
      and(
        eq(schema.invitations.createdBy, userId),
        sql`${schema.invitations.usedBy} IS NOT NULL`,
        gte(schema.invitations.createdAt, start),
        lt(schema.invitations.createdAt, end)
      )
    );

  const [category] = await db
    .select({
      name: schema.categories.name,
      torrents: sql<number>`count(*)::int`,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.categories,
      eq(schema.categories.id, schema.torrents.categoryId)
    )
    .where(
      and(
        eq(schema.torrents.uploaderId, userId),
        gte(schema.torrents.createdAt, start),
        lt(schema.torrents.createdAt, end)
      )
    )
    .groupBy(schema.categories.name)
    .orderBy(desc(sql`count(*)`))
    .limit(1);

  const [best] = await db
    .select({
      infoHash: schema.torrents.infoHash,
      name: schema.torrents.name,
      snatches: schema.torrentStats.completed,
    })
    .from(schema.torrents)
    .innerJoin(
      schema.torrentStats,
      eq(schema.torrentStats.infoHash, schema.torrents.infoHash)
    )
    .where(
      and(
        eq(schema.torrents.uploaderId, userId),
        gte(schema.torrents.createdAt, start),
        lt(schema.torrents.createdAt, end)
      )
    )
    .orderBy(desc(schema.torrentStats.completed))
    .limit(1);

  return {
    year,
    uploads: uploads?.n ?? 0,
    uploadedBytesCatalogued: Number(uploads?.bytes ?? 0),
    snatches: grabs?.n ?? 0,
    seedTimeSeconds: Number(grabs?.seedTime ?? 0),
    bytesUp: Number(grabs?.up ?? 0),
    bytesDown: Number(grabs?.down ?? 0),
    bonusEarned: Number(bonus?.amount ?? 0),
    invitesUsed: invites?.n ?? 0,
    topCategory: category ?? null,
    bestRelease: best ?? null,
  };
}

/** The first snapshot the instance ever wrote, for the year selector. */
export async function firstSnapshotAt(): Promise<Date | null> {
  const [row] = await db
    .select({ at: schema.siteStats.createdAt })
    .from(schema.siteStats)
    .orderBy(schema.siteStats.createdAt)
    .limit(1);
  return row?.at ?? null;
}
