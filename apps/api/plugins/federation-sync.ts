/**
 * Federation catalogue sync cron.
 *
 * Mirrors the resilience pattern of `bonus-collector`: a cross-replica
 * Redis lock (only one API instance syncs per tick) + a persisted
 * last-tick timestamp so a redeploy mid-interval doesn't re-fire early.
 * No-op while federation is disabled, so a fresh install pays nothing.
 *
 * Interval via FEDERATION_SYNC_INTERVAL (ms, default 15 min).
 */
import { redis } from '~~/utils/server';
import { syncAllRecords } from '~~/utils/federation/recordSync';
import { syncPeerStats } from '~~/utils/federation/sidePasses';
import { syncSwarmPeers } from '~~/utils/federation/swarmSync';
import { db, schema } from '@trackarr/db';
import { eq, inArray } from 'drizzle-orm';
import {
  federationSuspended,
  getFederationConfig,
  isFederationLive,
  syncIntervalMs,
} from '~~/utils/federation/config';

const LAST_TICK_KEY = 'federation:sync:last_tick_ms';
const LOCK_KEY = 'federation:sync:lock';
const LOCK_TTL_S = 5 * 60;

export default defineNitroPlugin(async () => {
  // Shared with the health view, which reads the same number to decide what
  // "behind" means. Two readers of one setting is one reader too many.
  const INTERVAL_MS = syncIntervalMs();
  console.log(`[Federation Sync] Initialized — interval=${INTERVAL_MS}ms`);

  // Retire the bookkeeping of the three feeds records replaced. Left behind,
  // their rows would sit on the federation health page forever, reporting a
  // last run that recedes further into the past every day — a permanent red
  // mark for a feed nobody polls any more.
  try {
    await db
      .delete(schema.federationSyncState)
      .where(
        inArray(schema.federationSyncState.resource, [
          'catalog',
          'catalog_refresh',
          'catalog_removals',
        ]),
      );
  } catch {
    /* cosmetic — never worth failing boot over */
  }

  const run = async () => {
    const start = Date.now();
    const config = await getFederationConfig().catch(() => null);
    if (!isFederationLive(config)) return; // federation off — nothing to do
    // Panic mode suspends the whole exchange, incoming and outgoing.
    if (await federationSuspended().catch(() => false)) return;

    const owner = `${process.pid}:${start}`;
    let holdsLock = false;
    try {
      const acquired = await redis.set(LOCK_KEY, owner, 'EX', LOCK_TTL_S, 'NX');
      if (acquired !== 'OK') return; // another replica is syncing
      holdsLock = true;

      // Pass 1 — the catalogue, as signed records. New releases, edits and
      // withdrawals all arrive here: with immutable records they are the same
      // kind of event, so they need one stream, not three feeds.
      const r = await syncAllRecords();
      console.log(
        `[Federation Sync] Tick — ${r.peers} peer(s), ${r.ingested} record(s), ${r.withdrawn} withdrawn, ${r.rejected} rejected (${Date.now() - start}ms)`,
      );

      // Pass 2 — swarm counts. Perishable by nature, so deliberately outside
      // the signed stream: an immutable record that carried a seeder count
      // would be re-minted every time the swarm breathed.
      try {
        const peers = (
          await db
            .select()
            .from(schema.federationPeers)
            .where(eq(schema.federationPeers.status, 'active'))
        ).filter((p) => p.acceptsFromThem?.catalog);
        let refreshed = 0;
        for (const peer of peers) refreshed += await syncPeerStats(peer);
        if (refreshed > 0) {
          console.log(`[Federation Sync] Stats — ${refreshed} row(s) refreshed`);
        }
      } catch (e) {
        console.warn(
          '[Federation Sync] stats pass failed:',
          (e as Error).message,
        );
      }
      // Phase 4 — refresh the cross-announce peer cache for swarm-federated
      // torrents. Best-effort; never blocks the catalogue result.
      try {
        const sw = await syncSwarmPeers();
        if (sw.torrents > 0) {
          console.log(
            `[Federation Sync] Swarm — ${sw.peers} remote peer(s) cached across ${sw.torrents} torrent(s)`,
          );
        }
      } catch (e) {
        console.warn('[Federation Sync] swarm sync failed:', (e as Error).message);
      }

      try {
        await redis.set(LAST_TICK_KEY, String(Date.now()));
      } catch {
        /* non-fatal */
      }
    } catch (err) {
      console.error('[Federation Sync] Tick failed:', err);
    } finally {
      if (holdsLock) {
        try {
          await redis.eval(
            `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
            1,
            LOCK_KEY,
            owner,
          );
        } catch {
          /* TTL releases it */
        }
      }
    }
  };

  // Schedule relative to the last persisted tick (survives restarts).
  const SETTLE_DELAY_MS = 45_000;
  let firstDelay = SETTLE_DELAY_MS;
  try {
    const raw = await redis.get(LAST_TICK_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(last) && last > 0) {
      const elapsed = Date.now() - last;
      if (elapsed < INTERVAL_MS) firstDelay = INTERVAL_MS - elapsed;
    }
  } catch {
    /* default delay */
  }

  setTimeout(run, firstDelay).unref?.();
  setInterval(run, INTERVAL_MS).unref?.();
});
