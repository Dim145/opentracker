/**
 * Keep the signed record set in step with the catalogue.
 *
 * Every visible torrent should have exactly one current record, and every
 * torrent that has stopped being visible should have a tombstone. This sweep
 * is what makes that true — including for the catalogue that existed before
 * records did.
 *
 * ## One cursor, not two
 *
 * A cursor over `coalesce(updated_at, created_at)` does the initial backfill
 * AND the incremental catch-up with the same mechanism: starting at the epoch
 * it walks the whole catalogue oldest-first, and once it reaches the present
 * it simply keeps up with edits, because an edit bumps `updated_at`. A
 * separate "backfill then switch mode" design would be two code paths and two
 * ways to be wrong.
 *
 * The cursor carries `(timestamp, id)` rather than a timestamp alone: two
 * torrents can share a millisecond, and a timestamp-only cursor either skips
 * one of them or loops on the pair forever.
 *
 * ## Idempotence is the safety net
 *
 * Minting compares a content fingerprint, so re-walking rows costs a hash and
 * writes nothing. That is what allows the cursor to be conservative — it may
 * re-read, it may never skip.
 *
 * Nothing runs while federation is off: no key, no issuer, and no reason to
 * pay for it.
 */
import {
  mintIdentityRecords,
  mintRevocations,
} from '~~/utils/federation/identityRecord';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from '~~/utils/federation/config';
import { didKeyFromPublicKey } from '~~/utils/federation/did';
import {
  PUBLISHABLE,
  mintRecords,
  mintTombstone,
  type MintContext,
} from '~~/utils/federation/catalogRecord';
import { getSetting, setSetting } from '~~/utils/server';
import { withCronLock } from '~~/utils/cronLock';

// Signing is microseconds; the cost is one transaction per new record. A
// modest batch keeps a first sweep over a large catalogue from holding a
// connection for minutes at a time.
const BATCH_SIZE = 200;
const BUSY_INTERVAL_MS = 3_000;
const IDLE_INTERVAL_MS = 5 * 60 * 1000;
const FIRST_RUN_DELAY_MS = 90 * 1000; // after the schema push has settled

const CURSOR_KEY = 'catalog_record_cursor';

/**
 * `<timestamp>|<id>`, and the timestamp never becomes a JavaScript `Date`.
 *
 * Two traps, both silent, both already paid for elsewhere in this codebase:
 *
 * - `new Date("2026-06-13 10:00:00")` parses a naive Postgres timestamp as
 *   LOCAL time, so `.toISOString()` shifts it by the container's offset. The
 *   cursor then walks backwards by that offset every tick and the sweep
 *   re-reads the same window forever, making progress only because minting is
 *   idempotent.
 * - `Date` holds milliseconds. Postgres timestamps hold microseconds, so a
 *   round trip truncates and a row in the truncated microsecond can be
 *   skipped — the same reason the federation catalogue feed carries a
 *   `to_char` cursor rather than a serialised `Date`.
 *
 * Keeping the value as the string Postgres produced avoids both.
 */
const EPOCH = '1970-01-01T00:00:00.000000';

function readCursor(raw: string | null): { ts: string; id: string } {
  const [ts, id] = (raw ?? '').split('|');
  return { ts: ts || EPOCH, id: id ?? '' };
}

const LIVE_AT = sql`coalesce(${schema.torrents.updatedAt}, ${schema.torrents.createdAt})`;

interface TickResult {
  minted: number;
  withdrawn: number;
  scanned: number;
}

async function tick(ctx: MintContext): Promise<TickResult> {
  const cursor = readCursor(await getSetting(CURSOR_KEY));

  const rows = await db
    .select({
      id: schema.torrents.id,
      // Microsecond precision, unambiguous, and never parsed by JavaScript.
      at: sql<string>`to_char(${LIVE_AT}, 'YYYY-MM-DD"T"HH24:MI:SS.US')`,
    })
    .from(schema.torrents)
    .where(
      and(
        PUBLISHABLE,
        or(
          sql`${LIVE_AT} > ${cursor.ts}::timestamp`,
          and(
            sql`${LIVE_AT} = ${cursor.ts}::timestamp`,
            sql`${schema.torrents.id} > ${cursor.id}`,
          ),
        ),
      ),
    )
    .orderBy(asc(sql`${LIVE_AT}`), asc(schema.torrents.id))
    .limit(BATCH_SIZE);

  let minted = 0;
  if (rows.length) {
    ({ minted } = await mintRecords(
      rows.map((r) => r.id),
      ctx,
    ));
    const last = rows[rows.length - 1]!;
    await setSetting(CURSOR_KEY, `${last.at}|${last.id}`);
  }

  // Withdrawals, independently of the cursor: a torrent that was hidden or
  // deleted does not move in a forward-only walk, so it would never come round
  // again. The left join catches both — hidden rows and rows that are simply
  // gone, since a record deliberately outlives its torrent.
  const stale = await db
    .select({ torrentId: schema.catalogRecords.torrentId })
    .from(schema.catalogRecords)
    .leftJoin(
      schema.torrents,
      eq(schema.torrents.id, schema.catalogRecords.torrentId),
    )
    .where(
      and(
        isNull(schema.catalogRecords.supersededAt),
        eq(schema.catalogRecords.kind, 'torrent'),
        // Gone, or no longer publishable — a ban counts, which is why the
        // condition is the same one minting uses rather than a copy that can
        // drift away from it.
        or(isNull(schema.torrents.id), sql`NOT (${PUBLISHABLE})`),
      ),
    )
    .limit(BATCH_SIZE);

  let withdrawn = 0;
  for (const s of stale) {
    if (!s.torrentId) continue;
    if (await mintTombstone(s.torrentId, ctx)) withdrawn++;
  }

  // Identity assertions, on the same sweep. Cheap — one query over the
  // members who have proven a past account, which on most instances is none —
  // and it keeps every kind of record this instance publishes on one clock.
  try {
    const ids = await mintIdentityRecords(ctx);
    minted += ids.minted;
    withdrawn += ids.withdrawn;
    minted += (await mintRevocations(ctx)).minted;
  } catch (err) {
    // A member's alias assertion failing must not stop the catalogue.
    console.warn('[CatalogRecords] identity records:', (err as Error).message);
  }

  return { minted, withdrawn, scanned: rows.length };
}

export default defineNitroPlugin(() => {
  const run = async () => {
    let busy = false;
    try {
      const config = await getFederationConfig();
      if (!isFederationLive(config)) {
        setTimeout(run, IDLE_INTERVAL_MS).unref?.();
        return;
      }
      const privateKeyPem = getPrivateKeyPem(config!);
      if (!privateKeyPem || !config!.publicKey) {
        setTimeout(run, IDLE_INTERVAL_MS).unref?.();
        return;
      }
      const did = didKeyFromPublicKey(config!.publicKey);

      // Cross-replica lock: every replica runs this plugin, and without it
      // they would walk the same cursor and race each other's writes.
      const publicUrl = config!.publicUrl ?? null;
      await withCronLock('catalog_records:lock', 120, async () => {
        const { minted, withdrawn, scanned } = await tick({
          privateKeyPem,
          did,
          publicUrl,
        });
        busy = scanned === BATCH_SIZE;
        if (minted || withdrawn) {
          console.log(
            `[CatalogRecords] minted=${minted} withdrawn=${withdrawn} scanned=${scanned}`,
          );
        }
      });
    } catch (err) {
      console.warn('[CatalogRecords] tick failed:', (err as Error).message);
    }
    // Re-arm from the outcome: a full batch means there is more catalogue to
    // walk, so the next tick follows almost immediately; a short one means we
    // have caught up and the sweep drops to a heartbeat.
    setTimeout(run, busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS).unref?.();
  };

  setTimeout(run, FIRST_RUN_DELAY_MS).unref?.();
});
