/**
 * What the record store actually holds, counted for the operator.
 *
 * Its own file, and not for tidiness. This is an aggregate with `FILTER`
 * clauses and a two-column grouping, sitting behind an admin session on a page
 * that auto-refreshes — which means a mistake in it either shows a wrong
 * number for months or throws on a page nobody loads while testing. Neither
 * failure announces itself. Out here it can be run against a real database.
 *
 * These numbers exist because `origin` and `hops` appeared nowhere at all: an
 * operator could turn relaying on and have no way to see whether anything was
 * being carried, nor turn it off and see what stopped.
 */
import { inArray, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

export interface RecordStore {
  /** Minted here, still current. What the outbox serves. */
  local: number;
  /** Taken from partners, still current. */
  ingested: number;
  /** Of those, the ones we would hand on — first hand only, two-hop bound. */
  relayable: number;
  /** Replaced generations, kept because a proof over them still exists. */
  superseded: number;
  /** Per kind, so a tombstone or identity backlog is visible as itself. */
  byKind: Record<string, number>;
}

/** One grouped scan. The page refreshes on a timer, so this is paid daily. */
export async function recordStore(): Promise<RecordStore> {
  const rows = await db
    .select({
      origin: schema.catalogRecords.origin,
      kind: schema.catalogRecords.kind,
      live: sql<number>`count(*) FILTER (WHERE ${schema.catalogRecords.supersededAt} IS NULL)::int`,
      superseded: sql<number>`count(*) FILTER (WHERE ${schema.catalogRecords.supersededAt} IS NOT NULL)::int`,
      relayable: sql<number>`count(*) FILTER (
        WHERE ${schema.catalogRecords.supersededAt} IS NULL
          AND ${schema.catalogRecords.origin} = 'ingested'
          AND ${schema.catalogRecords.hops} <= 1)::int`,
    })
    .from(schema.catalogRecords)
    .groupBy(schema.catalogRecords.origin, schema.catalogRecords.kind);

  const out: RecordStore = {
    local: 0,
    ingested: 0,
    relayable: 0,
    superseded: 0,
    byKind: {},
  };
  for (const r of rows) {
    if (r.origin === 'local') out.local += Number(r.live);
    else out.ingested += Number(r.live);
    out.relayable += Number(r.relayable);
    out.superseded += Number(r.superseded);
    // Superseded generations are counted apart, never in a kind: `byKind` is
    // read as "what we hold right now", and folding replaced rows into it
    // would make an edited release look like two.
    out.byKind[r.kind] = (out.byKind[r.kind] ?? 0) + Number(r.live);
  }
  return out;
}

/**
 * How many records we hold on each partner's behalf.
 *
 * Exactly the set reconciliation compares — which is why the health view shows
 * it beside the mirror count rather than instead of it. The two differ by the
 * records that have no mirror row, and a version of this page without it let a
 * real defect run for a whole step: reconciliation compared the mirror, so
 * tombstones and identity records were re-fetched on every tick, forever,
 * reporting `items=0` and `status=ok`.
 */
export async function sourcedByPeer(
  peerIds: string[],
): Promise<Map<string, number>> {
  if (!peerIds.length) return new Map();
  const rows = await db
    .select({
      peerId: schema.recordSources.peerId,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.recordSources)
    .where(inArray(schema.recordSources.peerId, peerIds))
    .groupBy(schema.recordSources.peerId);
  return new Map(rows.map((r) => [r.peerId, Number(r.count)] as const));
}
