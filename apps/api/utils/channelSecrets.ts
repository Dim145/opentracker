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
 * `NUXT_SESSION_SECRET` — the same secret that already gates session
 * cookies and IP hashing, so the threat model is consistent. A
 * dedicated `CHANNEL_ENCRYPTION_KEY` can override it for operators
 * who prefer key separation.
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
  // Fixed salt keeps the derived key stable across restarts; the
  // input secret is already high-entropy so we don't need PBKDF2
  // iterations beyond scrypt's default cost. 32 bytes = AES-256.
  cachedKey = scryptSync(raw, 'trackarr:channels:v1', 32) as Buffer;
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
