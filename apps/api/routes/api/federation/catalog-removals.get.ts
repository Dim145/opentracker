/**
 * GET /api/federation/catalog-removals?since=&sinceId=&limit=  — inbound, S2S.
 *
 * Tombstone feed: torrents that STOPPED being federatable on us (hard-deleted,
 * moderation-pulled, or uploader banned — see `federationCatalogRemovals`).
 * A partner walks it forward by the composite (removed_at, id) cursor and
 * deletes the matching `remote_torrents` row, so the append-forward catalogue
 * sync's blind spot (it never re-reads old rows) is closed.
 *
 * Gated on the `catalog` scope, same as the catalogue itself. Emits a
 * microsecond-precision cursor (`to_char` + `::timestamp` compare) so the
 * boundary row isn't perpetually re-sent.
 */
import { asc, sql } from 'drizzle-orm';
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

  const t = schema.federationCatalogRemovals;
  const where = sinceStr
    ? sinceId
      ? sql`(${t.removedAt} > ${sinceStr}::timestamp or (${t.removedAt} = ${sinceStr}::timestamp and ${t.id} > ${sinceId}))`
      : sql`${t.removedAt} > ${sinceStr}::timestamp`
    : undefined;

  const rows = await db
    .select({
      id: t.id, // removal-row id — the cursor tie-break
      remoteId: t.torrentId, // == partner's remote_torrents.remote_id
      infoHash: t.infoHash,
      contentSignature: t.contentSignature,
      reason: t.reason,
      cursor: sql<string>`to_char(${t.removedAt}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(t)
    .where(where)
    .orderBy(asc(t.removedAt), asc(t.id))
    .limit(limit);

  const items = rows.map((r) => ({
    remoteId: r.remoteId,
    infoHash: r.infoHash,
    contentSignature: r.contentSignature,
    reason: r.reason,
  }));
  const lastRow = rows[rows.length - 1];
  const nextCursor = lastRow
    ? { t: lastRow.cursor, id: lastRow.id }
    : sinceStr
      ? { t: sinceStr, id: sinceId }
      : null;

  return { ok: true, items, nextCursor, count: items.length };
});
