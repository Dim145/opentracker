/**
 * Encryption helpers for notification-channel secrets at rest.
 *
 * `notificationChannels.serverConfig` (SMTP password, Telegram bot
 * token, Apprise API URL, …) and `userNotificationChannels.userConfig`
 * (per-user webhook URL, chat_id, email "to", …) are JSON blobs we
 * **must not** store in plaintext: a DB dump or a SQLi anywhere in the
 * app would otherwise hand attackers a working set of credentials for
 * every external service the tracker is wired to.
 *
 * We re-use `panic.ts`'s AES-GCM primitive (fresh IV per record, auth
 * tag bound to the ciphertext) and derive the key once at boot from
 * `NUXT_SESSION_SECRET` — the same secret that already seals session
 * cookies (IP hashing uses a SEPARATE `IP_HASH_SECRET`). A dedicated
 * `CHANNEL_ENCRYPTION_KEY` can override it for operators who prefer
 * key separation; setting it shrinks the blast radius of a
 * NUXT_SESSION_SECRET leak to "session forgery only".
 *
 * If neither var is set, this module throws on first use. That's
 * intentional: a misconfigured deployment must not silently store
 * secrets in plaintext.
 */
import { scryptSync } from 'crypto';
import { encrypt, decrypt } from './panic';

let cachedKey: Buffer | null = null;

/**
 * Resolve and cache the encryption key. Lazy on purpose — `notify.ts`
 * is imported very early (route handlers, sweeper plugin) and we don't
 * want the import to fail just because the env var is read before the
 * Nitro runtime hands them through.
 */
function getKey(): Buffer {
  if (cachedKey) return cachedKey;
  const raw =
    process.env.CHANNEL_ENCRYPTION_KEY || process.env.NUXT_SESSION_SECRET;
  if (!raw) {
    throw new Error(
      '[channelSecrets] Neither CHANNEL_ENCRYPTION_KEY nor NUXT_SESSION_SECRET is set; refusing to encrypt/decrypt channel configs. Generate one with `openssl rand -hex 32`.'
    );
  }
  // Reject a weak secret here too. The session path enforces >=32
  // chars (session.ts), but this code reads the env var directly, so
  // without its own check a 1-char secret would silently produce a
  // trivially brute-forceable AES key while reporting success
  // (finding: no min-strength validation on the channel KDF path).
  if (raw.length < 32) {
    throw new Error(
      '[channelSecrets] CHANNEL_ENCRYPTION_KEY / NUXT_SESSION_SECRET must be at least 32 characters. Generate one with `openssl rand -hex 32`.'
    );
  }
  // Salt: defaults to the legacy fixed value so existing ciphertext
  // still decrypts. A fresh deployment may set CHANNEL_ENCRYPTION_SALT
  // to a unique value for per-deployment key separation (do NOT change
  // it on a deployment that already has encrypted channel secrets —
  // that would make them undecryptable). 32 bytes = AES-256.
  const salt = process.env.CHANNEL_ENCRYPTION_SALT || 'trackarr:channels:v1';
  cachedKey = scryptSync(raw, salt, 32) as Buffer;
  return cachedKey;
}

/**
 * Encrypt an arbitrary JSON-serialisable value. Empty/`null` inputs
 * round-trip as the empty string — that maps cleanly onto the
 * `text NOT NULL DEFAULT ''` columns the schema uses for channels
 * that don't need server-side config (Discord/Slack/Mattermost).
 */
export function encryptJson(value: unknown): string {
  if (value == null) return '';
  const json = typeof value === 'string' ? value : JSON.stringify(value);
  if (json.length === 0) return '';
  return encrypt(json, getKey());
}

/**
 * Inverse of `encryptJson`. Returns `null` for empty strings so
 * adapters can distinguish "no config" from "config error". Throws
 * on tag mismatch (data drift or key change) — the caller decides
 * whether to log + skip or hard-fail.
 */
export function decryptJson<T = Record<string, unknown>>(
  blob: string | null | undefined
): T | null {
  if (!blob) return null;
  const json = decrypt(blob, getKey());
  return JSON.parse(json) as T;
}

/**
 * Test helper — surfaces a clear error when the deployment forgot to
 * set a secret. The admin "Test" endpoint calls this before touching
 * the row so the UI shows the misconfig before garbage is written.
 */
export function assertChannelEncryptionReady(): void {
  getKey();
}
