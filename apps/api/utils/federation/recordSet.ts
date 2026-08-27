/**
 * The two sets reconciliation runs over, as Postgres sees them.
 *
 * A `SetSource` has to summarise an interval without materialising it — a
 * range can hold the whole catalogue — so every operation here is one indexed
 * query and the fingerprint is computed in SQL.
 *
 * That makes the fingerprint the dangerous part. It is defined in `rbsr.ts`,
 * in one sentence, and it MUST come out identical whether it is computed there
 * over an array or here over a table: a store that fingerprints its own way
 * does not fail loudly, it agrees confidently with a partner about a set the
 * two of them do not actually share. There is an integration test whose only
 * job is to hold the two implementations against each other.
 */
import { sql, type SQL } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { Bucket, SetSource } from './rbsr';

/**
 * The fingerprint, in SQL. Mirrors `fingerprint()` in `rbsr.ts` exactly:
 * the ids joined by newlines, then `|`, then the count, hashed, first 32 hex
 * characters. `coalesce` handles the empty interval, which must hash `|0`
 * rather than NULL.
 */
function fpExpr(idCol: SQL): SQL {
  return sql`left(encode(sha256(convert_to(
    coalesce(string_agg(${idCol}, E'\n' ORDER BY ${idCol}), '') || '|' || count(*)::text,
    'UTF8')), 'hex'), 32)`;
}

/** `[lo, hi)` over an id column, with `hi = null` meaning +infinity. */
function within(idCol: SQL, lo: string, hi: string | null): SQL {
  return hi === null
    ? sql`${idCol} >= ${lo}`
    : sql`${idCol} >= ${lo} AND ${idCol} < ${hi}`;
}

/**
 * Build a source over one id column of one relation.
 *
 * `from` carries the table and any join; `where` is the standing predicate
 * that defines what belongs to the set at all — a peer's rows, or the records
 * we still publish.
 */
function sqlSource(idCol: SQL, from: SQL, where: SQL): SetSource {
  return {
    async summary(lo, hi) {
      const [row] = (await db.execute<{ fp: string; n: number }>(sql`
        SELECT ${fpExpr(idCol)} AS fp, count(*)::int AS n
          FROM ${from}
         WHERE (${where}) AND ${within(idCol, lo, hi)}
      `)) as unknown as Array<{ fp: string; n: number }>;
      return { fp: row?.fp ?? '', n: Number(row?.n ?? 0) };
    },

    async ids(lo, hi, limit) {
      const rows = (await db.execute<{ id: string }>(sql`
        SELECT ${idCol} AS id
          FROM ${from}
         WHERE (${where}) AND ${within(idCol, lo, hi)}
         ORDER BY ${idCol}
         LIMIT ${limit}
      `)) as unknown as Array<{ id: string }>;
      return rows.map((r) => r.id);
    },

    async buckets(lo, hi, count) {
      // `ntile` cuts the interval into equal pieces in one pass, and the
      // fingerprint of each piece comes back from the same scan. Doing it as
      // one query per bucket would be sixteen index scans over what is
      // already one.
      const rows = (await db.execute<{ lo_id: string; fp: string; n: number }>(sql`
        WITH r AS (
          SELECT ${idCol} AS id
            FROM ${from}
           WHERE (${where}) AND ${within(idCol, lo, hi)}
        ), t AS (
          SELECT id, ntile(${count}) OVER (ORDER BY id) AS bucket FROM r
        )
        SELECT min(id) AS lo_id,
               count(*)::int AS n,
               left(encode(sha256(convert_to(
                 coalesce(string_agg(id, E'\n' ORDER BY id), '') || '|' || count(*)::text,
                 'UTF8')), 'hex'), 32) AS fp
          FROM t
         GROUP BY bucket
         ORDER BY bucket
      `)) as unknown as Array<{ lo_id: string; fp: string; n: number }>;

      // The first piece keeps the interval's own lower bound and the last its
      // upper one, so the pieces partition `[lo, hi)` exactly. Anything else
      // would leave a sliver of the id space that neither side ever compares.
      return rows.map<Bucket>((r, i) => ({
        lo: i === 0 ? lo : r.lo_id,
        hi: i === rows.length - 1 ? hi : rows[i + 1]!.lo_id,
        fp: r.fp,
        n: Number(r.n),
      }));
    },
  };
}

/**
 * What this instance serves: every record it has minted and not superseded,
 * tombstones included — a withdrawal is a record like any other and a partner
 * needs it to learn the release is gone.
 *
 * With relaying on, it also serves what it took in at first hand. A partner
 * reconciling against us then converges on a set larger than our own
 * catalogue, which is the whole point: one link to us instead of one link to
 * everyone we know.
 *
 * No settle window, unlike the feed this replaces. That five-second delay
 * existed because a sequence number can be assigned before it is committed,
 * so a cursor could step over a record it never saw. Reconciliation makes no
 * ordering assumption at all: a record that appears in the middle of a
 * conversation is simply picked up by the next one.
 */
export function publishedSet(relaying = false): SetSource {
  // What we hand on when relaying: ours, plus what we took FIRST-HAND. Never
  // what was already relayed to us — that is where the two-hop bound is
  // enforced, and it is enforced here rather than by trusting a partner's
  // account of how far a record has travelled.
  const scope = relaying
    ? sql`(${schema.catalogRecords.origin} = 'local'
           OR (${schema.catalogRecords.origin} = 'ingested' AND ${schema.catalogRecords.hops} <= 1))`
    : sql`${schema.catalogRecords.origin} = 'local'`;

  return sqlSource(
    sql`${schema.catalogRecords.id}`,
    sql`${schema.catalogRecords}`,
    sql`${schema.catalogRecords.supersededAt} IS NULL AND ${scope}`,
  );
}

/**
 * What we hold from one partner — every record, of every kind.
 *
 * This used to read the MIRROR, and that was wrong in a way that cost nothing
 * visible and never stopped costing. `remote_torrents` holds torrents; a
 * partner's set also holds tombstones, identity assertions and revocations. So
 * every one of those was permanently missing from our side: fetched again on
 * every tick, ingested to no effect, still missing — with `ingested=0`,
 * `status=ok` and no log line, because nothing about it moved a counter.
 *
 * A record is content-addressed, so a partner offers a set of ids. This is the
 * same kind of thing on our side, which is the only reason the two compare.
 */
export function mirrorSet(peerId: string): SetSource {
  return sqlSource(
    sql`${schema.recordSources.recordId}`,
    sql`${schema.recordSources}`,
    sql`${schema.recordSources.peerId} = ${peerId}`,
  );
}
