/**
 * Federation config singleton — the owner's master switch, this
 * instance's verifiable identity, and the default sharing scopes.
 *
 * The Ed25519 identity is generated lazily the first time federation is
 * enabled (`ensureFederationIdentity`) so a fresh install carries no key
 * material until the owner opts in. The private key is encrypted at rest
 * via `encryptJson` (wrapped as `{ pem }` so the JSON round-trip in
 * channelSecrets stays valid for a non-JSON PEM string).
 */
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { schema } from '@trackarr/db';
import {
  federationConfig,
  type FederationConfig,
} from '@trackarr/db/schema';
import { encryptJson, decryptJson } from '../channelSecrets';
import { redis } from '../server';
import { generateInstanceKeypair } from './keys';

const SINGLETON = 'singleton';

/**
 * Is federation on? Cached for a minute, and ONLY for cosmetic callers.
 *
 * `/api/branding` is fetched on every page navigation by every user, and every
 * other field it returns comes from the settings cache — so it costs no query
 * in the steady state and keeps serving through a brief database hiccup.
 * Reading the config directly there would have given up both: one query per
 * page load, and a 500 on the endpoint the whole site depends on whenever
 * Postgres blinks.
 *
 * Deliberately NOT used by getFederationConfig's other callers. inbound.ts
 * gates on it (404 when federation is off), so caching there would leave a
 * just-disabled instance accepting federated requests until the entry expired.
 * The cost of staleness is asymmetric: a nav item that lingers for up to a
 * minute is cosmetic, an authorisation check that lingers is not.
 *
 * No invalidation on write for the same reason it needs none: nothing about a
 * nav item justifies wiring another pub/sub channel. The bound is the TTL.
 */
const ENABLED_TTL_MS = 60_000;
let enabledCache: { value: boolean; at: number } | null = null;

export async function isFederationEnabledCosmetic(): Promise<boolean> {
  if (enabledCache && Date.now() - enabledCache.at < ENABLED_TTL_MS) {
    return enabledCache.value;
  }
  const value = (await getFederationConfig())?.enabled ?? false;
  enabledCache = { value, at: Date.now() };
  return value;
}

export async function getFederationConfig(): Promise<FederationConfig | null> {
  const [row] = await db
    .select()
    .from(federationConfig)
    .where(eq(federationConfig.id, SINGLETON))
    .limit(1);
  return row ?? null;
}

/** True when federation is on AND the identity is fully provisioned. */
export function isFederationLive(
  config: FederationConfig | null
): config is FederationConfig {
  return !!(
    config?.enabled &&
    config.instanceId &&
    config.publicKey &&
    config.privateKeyEnc
  );
}

/**
 * Read the config, generating the row + Ed25519 identity if missing.
 * Idempotent: an already-provisioned identity is returned untouched
 * (we never rotate a live key here — that would orphan every peer that
 * trusts the old one).
 */
export async function ensureFederationIdentity(): Promise<FederationConfig> {
  const existing = await getFederationConfig();
  if (
    existing?.instanceId &&
    existing.publicKey &&
    existing.privateKeyEnc
  ) {
    return existing;
  }

  // A PARTIALLY provisioned identity (some columns set, others null) is an
  // anomaly — never regenerate over it, or we'd rotate the live key and orphan
  // every peer that trusts the current public key.
  if (
    existing &&
    (existing.instanceId || existing.publicKey || existing.privateKeyEnc)
  ) {
    throw new Error(
      'Federation identity is partially provisioned; refusing to rotate the key. Restore the missing column(s) or reset the row deliberately.',
    );
  }

  const kp = generateInstanceKeypair();
  const identity = {
    instanceId: kp.instanceId,
    publicKey: kp.publicKeyPem,
    privateKeyEnc: encryptJson({ pem: kp.privateKeyPem }),
  };

  const [row] = await db
    .insert(federationConfig)
    .values({ id: SINGLETON, ...identity })
    .onConflictDoUpdate({
      target: federationConfig.id,
      // Only fills the identity columns; preserves enabled / scopes /
      // name already set by an earlier PUT. Safe because we only reach
      // here when at least one identity column was null.
      set: { ...identity, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** Decrypt the instance private key (PEM). Null when not provisioned. */
export function getPrivateKeyPem(config: FederationConfig): string | null {
  if (!config.privateKeyEnc) return null;
  const dec = decryptJson<{ pem: string }>(config.privateKeyEnc);
  return dec?.pem ?? null;
}

/**
 * How often the catalogue sync runs, in milliseconds.
 *
 * One reader, because there used to be two and they disagreed: the cron read
 * `FEDERATION_SYNC_INTERVAL` — the name both guides document — while the health
 * view read `FEDERATION_SYNC_INTERVAL_MS`, which nothing sets and nothing
 * documents. So the view always drew its gauge against fifteen minutes. On an
 * instance syncing faster that is merely wrong; on one syncing slower than the
 * "behind" threshold it marks every healthy partner as behind, permanently.
 * Found by reading a live page that said "every 15 min" over a mesh ticking
 * every twenty seconds.
 */
export function syncIntervalMs(): number {
  const raw = Number(process.env.FEDERATION_SYNC_INTERVAL);
  return Number.isFinite(raw) && raw > 0 ? raw : 900_000;
}

/**
 * Whether federation is suspended because the instance is in panic mode.
 *
 * Panic encrypts the catalogue in place, and it is meant to STOP exfiltration
 * during an incident — the proposal is explicit about that. It did neither:
 * nothing in the federation path consulted the panic flag, so the sync and
 * mint loops kept running (and, because the panic UPDATE bumps `updated_at`,
 * the mint cursor walked the whole catalogue again and re-published a signed
 * record with `name = '[ENCRYPTED]'` and `size = 0` for every torrent, which
 * every partner then ingested over good data), while the S2S endpoints kept
 * serving the catalogue.
 *
 * This is the one flag that gates all of it. Read through a short Redis cache
 * because it is now consulted on the hot serving path; a stale value costs at
 * most `PANIC_CACHE_TTL_S` seconds of the very thing panic is racing to stop,
 * which is why the window is small. On any Redis error it falls back to the
 * database rather than failing open — panic must not be defeated by a cache
 * miss.
 */
const PANIC_CACHE_KEY = 'federation:panic:suspended';
const PANIC_CACHE_TTL_S = 5;

export async function federationSuspended(): Promise<boolean> {
  try {
    const cached = await redis.get(PANIC_CACHE_KEY);
    if (cached !== null) return cached === '1';
  } catch {
    /* fall through to the database */
  }
  const [row] = await db
    .select({ isEncrypted: schema.panicState.isEncrypted })
    .from(schema.panicState)
    .limit(1);
  const suspended = !!row?.isEncrypted;
  try {
    await redis.setex(PANIC_CACHE_KEY, PANIC_CACHE_TTL_S, suspended ? '1' : '0');
  } catch {
    /* best effort */
  }
  return suspended;
}
