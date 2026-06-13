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
import { syncAllCatalogues } from '~~/utils/federation/catalogSync';
import { syncSwarmPeers } from '~~/utils/federation/swarmSync';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';

const LAST_TICK_KEY = 'federation:sync:last_tick_ms';
const LOCK_KEY = 'federation:sync:lock';
const LOCK_TTL_S = 5 * 60;

export default defineNitroPlugin(async () => {
  const INTERVAL_MS = parseInt(
    process.env.FEDERATION_SYNC_INTERVAL || '900000',
    10,
  );
  console.log(`[Federation Sync] Initialized — interval=${INTERVAL_MS}ms`);

  const run = async () => {
    const start = Date.now();
    const config = await getFederationConfig().catch(() => null);
    if (!isFederationLive(config)) return; // federation off — nothing to do

    const owner = `${process.pid}:${start}`;
    let holdsLock = false;
    try {
      const acquired = await redis.set(LOCK_KEY, owner, 'EX', LOCK_TTL_S, 'NX');
      if (acquired !== 'OK') return; // another replica is syncing
      holdsLock = true;

      const r = await syncAllCatalogues();
      console.log(
        `[Federation Sync] Tick — ${r.peers} peer(s), ${r.synced} torrent(s), ${r.removed} removed (${Date.now() - start}ms)`,
      );
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
