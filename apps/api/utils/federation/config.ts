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
import {
  federationConfig,
  type FederationConfig,
} from '@trackarr/db/schema';
import { encryptJson, decryptJson } from '../channelSecrets';
import { generateInstanceKeypair } from './keys';

const SINGLETON = 'singleton';

export async function getFederationConfig(): Promise<FederationConfig | null> {
  const [row] = await db
    .select()
    .from(federationConfig)
    .where(eq(federationConfig.id, SINGLETON))
    .limit(1);
  return row ?? null;
}

/** True when federation is on AND the identity is fully provisioned. */
export function isFederationLive(config: FederationConfig | null): boolean {
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
