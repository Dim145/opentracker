/**
 * GET /api/federation/catalog-stats?since=&sinceId=&limit=  — inbound, S2S.
 *
 * Swarm counts, and the only thing left that a signed record cannot carry.
 * A record is immutable, so a seeder figure inside one would mint a new record
 * every time somebody stopped seeding — the catalogue would churn constantly
 * and say nothing more. Counts therefore travel here instead, unsigned, which
 * is honest about what they are: a hint with a short shelf life rather than a
 * claim anybody stands behind.
 *
 * The feed walks our federatable torrents by `torrent_stats.updated_at`
 * (composite cursor with info_hash) so the freshest changes land first, and a
 * partner applies them to rows it already mirrors. It cannot create one: the
 * ingesting side does UPDATEs and nothing else, which is what keeps the last
 * unsigned path from being an insertion path.
 *
 * Gated on the `catalog` scope, with the same eligibility as minting, so a
 * de-listed torrent's stale counts stop being refreshed.
 */
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 100;

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  const sinceStr =
    typeof q.since === 'string' && !Number.isNaN(new Date(q.since).getTime())
      ? q.since
      : null;
  const sinceId = typeof q.sinceId === 'string' ? q.sinceId : null;
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const st = schema.torrentStats;
  const to = schema.torrents;
  const conditions = [
    eq(to.moderationStatus, 'accepted'),
    eq(to.isActive, true),
    or(isNull(schema.users.id), eq(schema.users.isBanned, false))!,
  ];
  if (sinceStr) {
    conditions.push(
      sinceId
        ? sql`(${st.updatedAt} > ${sinceStr}::timestamp or (${st.updatedAt} = ${sinceStr}::timestamp and ${to.infoHash} > ${sinceId}))`
        : sql`${st.updatedAt} > ${sinceStr}::timestamp`,
    );
  }

  const rows = await db
    .select({
      infoHash: to.infoHash,
      seeders: st.seeders,
      leechers: st.leechers,
      completed: st.completed,
      cursor: sql<string>`to_char(${st.updatedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(to)
    .innerJoin(st, eq(to.infoHash, st.infoHash))
    .leftJoin(schema.users, eq(to.uploaderId, schema.users.id))
    .where(and(...conditions))
    .orderBy(asc(st.updatedAt), asc(to.infoHash))
    .limit(limit);

  const items = rows.map((r) => ({
    infoHash: r.infoHash,
    seeders: r.seeders ?? 0,
    leechers: r.leechers ?? 0,
    completed: r.completed ?? 0,
  }));
  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow
    ? { t: lastRow.cursor, id: lastRow.infoHash }
    : sinceStr
      ? { t: sinceStr, id: sinceId }
      : null;

  return { ok: true, items, nextCursor, count: items.length };
});
