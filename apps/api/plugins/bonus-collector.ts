/**
 * Bonus collector — periodically credits `users.bonus_points` from
 * the rules in `bonus_rules` + the curves in `bonus_seed_count_tiers`
 * + `bonus_age_tiers`.
 *
 * Five sources fire on each tick:
 *
 *   1. `seeding`             every active seeder of every torrent gets
 *                            `pointsPerHourPerSeed × intervalHours ×
 *                            seedCountMul × ageMul / 10000` points.
 *   2. `first_seeder`        any (user, torrent) pair where the user is
 *                            the *only* seeder collects a one-time
 *                            reward (idempotent via the grants ledger).
 *   3. `seeding_milestone`   per-torrent cumulative seed-time
 *                            thresholds emit single-shot grants when
 *                            crossed.
 *   4. `account_age_monthly` once-every-30-days loyalty bonus, gated
 *                            on the grants ledger.
 *
 * `daily_login` lives outside the cron (it fires on the first
 * /api/auth/status hit of each UTC day — see
 * `utils/bonusEarning.ts:creditDailyLoginIfDue`).
 *
 * Source of truth for active seeders:
 *   - We walk the same `peers:*` Redis hashes the stats collector
 *     uses, but pull `userId` out of each peer JSON. Peers from
 *     before the tracker started writing `userId` are skipped — they
 *     graduate as soon as their next announce updates the entry.
 *
 * Bounded by `SCAN_TIME_BUDGET_MS` so a 100k+ peer swarm can't pin
 * the event loop.
 */
import { eq, inArray, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';
import { v4 as uuidv4 } from 'uuid';
import {
  applyAccountAgeMonthlyRule,
  applyFirstSeederRule,
  applyMilestoneRule,
  applySeedingRule,
  bonusRuleConfigSchemas,
  BONUS_RULE_DEFAULTS,
  BONUS_RULE_KINDS,
  DEFAULT_AGE_TIERS,
  DEFAULT_SEED_COUNT_TIERS,
  loadRule,
  loadTiers,
  type BonusRuleKind,
} from '~~/utils/bonusEarning';

/**
 * Redis key holding the unix-ms timestamp of the last successful
 * tick. Surviving restarts is the whole point: without persistence,
 * every API reboot crashed the timer into "fire 30 s after boot",
 * which handed out a full-interval credit on every redeploy — a
 * 10-minute rolling restart loop would have credited 10× per hour
 * for `seeding`. With the key, the first tick after a restart only
 * fires once the original cadence has caught back up.
 *
 * Lives in the shared Redis instance so all replicas in a horizontal
 * deployment agree on the schedule — only one tick fires per interval
 * across the fleet, picked up by whichever replica wakes the timer
 * first (we acquire a short SETNX lock right before crediting).
 */
const LAST_TICK_KEY = 'bonus:collector:last_tick_ms';
const LOCK_KEY = 'bonus:collector:lock';
/** Lock TTL — generous so a 30 s SCAN budget doesn't trip the
 *  lock, but short enough that a crashed replica releases the slot
 *  before the next scheduled tick. */
const LOCK_TTL_S = 5 * 60;

export default defineNitroPlugin(async () => {
  const INTERVAL_MS = parseInt(
    process.env.BONUS_COLLECTION_INTERVAL || '3600000',
    10
  );
  const intervalHours = INTERVAL_MS / (60 * 60 * 1000);

  console.log(
    `[Bonus Collector] Initialized — interval=${INTERVAL_MS}ms (${intervalHours.toFixed(2)} h)`
  );

  // ---- One-time seeding of defaults so the operator has working
  //      curves out of the box. INSERT ... ON CONFLICT DO NOTHING
  //      keeps user edits safe across restarts.
  await ensureDefaults();

  const collect = async () => {
    const start = Date.now();
    let totalUsers = 0;
    let totalPoints = 0;
    // Cross-replica lock — only one API instance credits per tick.
    // The second arg is a per-process owner so a stale lock we
    // didn't put down doesn't get released by us either. Released
    // only on the happy path; on crash the TTL takes care of it.
    const owner = `${process.pid}:${start}`;
    let holdsLock = false;
    try {
      const acquired = await redis.set(
        LOCK_KEY,
        owner,
        'EX',
        LOCK_TTL_S,
        'NX'
      );
      if (acquired !== 'OK') {
        console.log(
          '[Bonus Collector] Another replica is mid-tick; skipping this run.'
        );
        return;
      }
      holdsLock = true;
      // 1. Walk Redis to build (userId, torrentInfoHash) → seed count
      //    and unique (torrent → seeder set) so we can compute
      //    seedersForTorrent and identify unique-seeder pairs.
      const SCAN_TIME_BUDGET_MS = 30_000;
      const deadline = start + SCAN_TIME_BUDGET_MS;
      let truncated = false;
      const keyPrefix = process.env.REDIS_KEY_PREFIX || 'ot:';
      const torrentSeederUsers = new Map<string, Set<string>>(); // infoHash → set of userIds seeding
      let cursor = '0';
      do {
        if (Date.now() > deadline) {
          truncated = true;
          break;
        }
        const [next, keys] = await redis.scan(
          cursor,
          'MATCH',
          `${keyPrefix}peers:*`,
          'COUNT',
          100
        );
        cursor = next;
        for (const fullKey of keys) {
          const key = fullKey.startsWith(keyPrefix)
            ? fullKey.slice(keyPrefix.length)
            : fullKey;
          // Key format `peers:{infoHashHex}` — strip the prefix.
          const infoHash = key.slice('peers:'.length);
          const peers = await redis.hgetall(key);
          let set = torrentSeederUsers.get(infoHash);
          for (const json of Object.values(peers)) {
            try {
              const peer = JSON.parse(json as string) as {
                userId?: string;
                isSeeder?: boolean;
              };
              if (!peer.isSeeder || !peer.userId) continue;
              if (!set) {
                set = new Set();
                torrentSeederUsers.set(infoHash, set);
              }
              set.add(peer.userId);
            } catch {
              /* ignore malformed peer */
            }
          }
        }
      } while (cursor !== '0');

      if (torrentSeederUsers.size === 0) {
        // Nothing seeding — only the account-age sweep is worth
        // running. (Daily login lives in auth/status.)
        const ageRule = await loadRule('account_age_monthly');
        if (ageRule?.enabled) {
          const parsed = bonusRuleConfigSchemas.account_age_monthly.safeParse(
            ageRule.config
          );
          if (parsed.success) {
            const r = await applyAccountAgeMonthlyRule({ config: parsed.data });
            totalUsers += r.usersCredited;
            totalPoints += r.pointsAwarded;
          }
        }
        console.log(
          `[Bonus Collector] No active seeders — accountAge swept ${totalUsers} user(s) (+${totalPoints} pts).`
        );
        return;
      }

      // 2. Resolve infoHash → torrent.id + createdAt in a single round-trip.
      const infoHashes = [...torrentSeederUsers.keys()];
      const torrentRows = await db
        .select({
          id: schema.torrents.id,
          infoHash: schema.torrents.infoHash,
          createdAt: schema.torrents.createdAt,
        })
        .from(schema.torrents)
        .where(inArray(schema.torrents.infoHash, infoHashes));
      const infoHashToTorrent = new Map(
        torrentRows.map((t) => [t.infoHash, { id: t.id, createdAt: t.createdAt }])
      );

      // 3. Build the per-(user, torrent) seeding rows + the unique-
      //    seeder list for the first_seeder rule.
      const seederRows: Array<{
        userId: string;
        torrentId: string;
        seedersForTorrent: number;
        ageDays: number;
      }> = [];
      const uniqueSeederPairs: Array<{ userId: string; torrentId: string }> = [];
      const now = Date.now();
      for (const [infoHash, userSet] of torrentSeederUsers) {
        const torrent = infoHashToTorrent.get(infoHash);
        if (!torrent) continue;
        const ageDays = Math.max(
          0,
          Math.floor((now - torrent.createdAt.getTime()) / (24 * 60 * 60 * 1000))
        );
        const seedersForTorrent = userSet.size;
        for (const userId of userSet) {
          seederRows.push({
            userId,
            torrentId: torrent.id,
            seedersForTorrent,
            ageDays,
          });
          if (seedersForTorrent === 1) {
            uniqueSeederPairs.push({ userId, torrentId: torrent.id });
          }
        }
      }

      // 4. Resolve enabled tiers once for this tick.
      const tiers = await loadTiers();

      // 5. Apply each rule sequentially (no shared writes between rules).
      const seedingRule = await loadRule('seeding');
      if (seedingRule?.enabled) {
        const parsed = bonusRuleConfigSchemas.seeding.safeParse(seedingRule.config);
        if (parsed.success) {
          const r = await applySeedingRule({
            config: parsed.data,
            intervalHours,
            seederTorrentRows: seederRows,
            tiers,
          });
          totalUsers += r.usersCredited;
          totalPoints += r.pointsAwarded;
        }
      }

      const firstSeederRule = await loadRule('first_seeder');
      if (firstSeederRule?.enabled && uniqueSeederPairs.length > 0) {
        const parsed = bonusRuleConfigSchemas.first_seeder.safeParse(
          firstSeederRule.config
        );
        if (parsed.success) {
          const r = await applyFirstSeederRule({
            config: parsed.data,
            uniqueSeederPairs,
          });
          totalUsers += r.usersCredited;
          totalPoints += r.pointsAwarded;
        }
      }

      const milestoneRule = await loadRule('seeding_milestone');
      if (milestoneRule?.enabled) {
        const parsed = bonusRuleConfigSchemas.seeding_milestone.safeParse(
          milestoneRule.config
        );
        if (parsed.success) {
          const r = await applyMilestoneRule({ config: parsed.data });
          totalUsers += r.usersCredited;
          totalPoints += r.pointsAwarded;
        }
      }

      const ageRule = await loadRule('account_age_monthly');
      if (ageRule?.enabled) {
        const parsed = bonusRuleConfigSchemas.account_age_monthly.safeParse(
          ageRule.config
        );
        if (parsed.success) {
          const r = await applyAccountAgeMonthlyRule({ config: parsed.data });
          totalUsers += r.usersCredited;
          totalPoints += r.pointsAwarded;
        }
      }

      console.log(
        `[Bonus Collector] Tick complete — ${totalUsers} user-credit events, ${totalPoints} pts total ` +
          `(${seederRows.length} seeder rows, ${uniqueSeederPairs.length} unique seeders` +
          `${truncated ? ', SCAN truncated' : ''}, ${Date.now() - start}ms)`
      );
      // Persist the tick timestamp ONLY on the success path so a
      // mid-tick crash doesn't shift the next scheduled run by an
      // hour — the next replica retries on its next wake-up.
      try {
        await redis.set(LAST_TICK_KEY, String(Date.now()));
      } catch (err) {
        console.warn(
          '[Bonus Collector] Failed to persist last-tick timestamp:',
          (err as Error).message
        );
      }
    } catch (err) {
      console.error('[Bonus Collector] Tick failed:', err);
    } finally {
      if (holdsLock) {
        // Lua CAS so we don't release a lock another replica took
        // after our TTL expired.
        try {
          await redis.eval(
            `if redis.call('GET', KEYS[1]) == ARGV[1] then
               return redis.call('DEL', KEYS[1])
             else
               return 0
             end`,
            1,
            LOCK_KEY,
            owner
          );
        } catch {
          /* TTL will release it */
        }
      }
    }
  };

  // Schedule the first tick relative to the last persisted run
  // rather than the boot time. Three cases:
  //
  //   - no key yet (fresh install / first deploy) → run after a
  //     short settle delay, same UX as before.
  //   - last tick was < INTERVAL_MS ago → wait the remainder so a
  //     redeploy in the middle of an hour doesn't double-credit.
  //   - last tick was ≥ INTERVAL_MS ago (long outage, missed
  //     window) → run after the settle delay to catch up. Exactly
  //     one tick fires — we don't compound missed hours.
  const SETTLE_DELAY_MS = 30_000;
  let firstDelay = SETTLE_DELAY_MS;
  try {
    const raw = await redis.get(LAST_TICK_KEY);
    const last = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(last) && last > 0) {
      const elapsed = Date.now() - last;
      if (elapsed < INTERVAL_MS) {
        firstDelay = INTERVAL_MS - elapsed;
        console.log(
          `[Bonus Collector] Last tick was ${(elapsed / 60_000).toFixed(1)} min ago; ` +
            `waiting ${(firstDelay / 60_000).toFixed(1)} min before the next run.`
        );
      } else {
        console.log(
          `[Bonus Collector] Last tick was ${(elapsed / 60_000).toFixed(1)} min ago (≥ interval); ` +
            `running shortly after boot to catch up.`
        );
      }
    } else {
      console.log(
        '[Bonus Collector] No prior tick recorded — first run after settle delay.'
      );
    }
  } catch (err) {
    console.warn(
      '[Bonus Collector] Could not read last-tick timestamp; falling back to default delay:',
      (err as Error).message
    );
  }

  setTimeout(collect, firstDelay).unref?.();
  setInterval(collect, INTERVAL_MS).unref?.();
});

/**
 * Inserts default rules + tier curves on first boot. Per-row
 * `INSERT ... ON CONFLICT DO NOTHING` keeps user edits safe — once
 * a row exists for a kind / tier, this function is a no-op for it.
 */
async function ensureDefaults(): Promise<void> {
  // Rules
  for (const kind of BONUS_RULE_KINDS) {
    const config = BONUS_RULE_DEFAULTS[kind as BonusRuleKind];
    await db.execute(
      sql`INSERT INTO ${schema.bonusRules} (id, kind, enabled, config)
          VALUES (${uuidv4()}, ${kind}, true, ${sql.raw(`'${JSON.stringify(config).replaceAll("'", "''")}'::jsonb`)})
          ON CONFLICT (kind) DO NOTHING`
    );
  }

  // Tiers — only seed when the table is empty so an admin who
  // deletes every row to start fresh doesn't get the defaults
  // re-pushed on the next boot.
  const [seedTierCount] = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM ${schema.bonusSeedCountTiers}`
  );
  if (Number((seedTierCount as { c?: number })?.c ?? 0) === 0) {
    for (const t of DEFAULT_SEED_COUNT_TIERS) {
      await db.insert(schema.bonusSeedCountTiers).values({
        id: uuidv4(),
        maxSeeders: t.maxSeeders,
        multiplier: t.multiplier,
        enabled: true,
      });
    }
  }
  const [ageTierCount] = await db.execute<{ c: number }>(
    sql`SELECT COUNT(*)::int AS c FROM ${schema.bonusAgeTiers}`
  );
  if (Number((ageTierCount as { c?: number })?.c ?? 0) === 0) {
    for (const t of DEFAULT_AGE_TIERS) {
      await db.insert(schema.bonusAgeTiers).values({
        id: uuidv4(),
        minAgeDays: t.minAgeDays,
        multiplier: t.multiplier,
        enabled: true,
      });
    }
  }
}
