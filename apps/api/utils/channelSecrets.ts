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
let cachedKeys: { current: Buffer; previous: Buffer | null } | null = null;

/**
 * Resolve and cache the encryption key. Lazy on purpose — `notify.ts`
 * is imported very early (route handlers, sweeper plugin) and we don't
 * want the import to fail just because the env var is read before the
 * Nitro runtime hands them through.
 */
/**
 * La clé courante et, si elle est déclarée, la précédente.
 *
 * `credentialSecrets.ts` gère `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS` et
 * ré-chiffre à la connexion prouvée ; ce module-ci n'avait aucun équivalent, et
 * la clé retombe par défaut sur `NUXT_SESSION_SECRET`. Or faire tourner
 * `NUXT_SESSION_SECRET` est une opération périodique banale qui, avant cette
 * fonctionnalité, n'invalidait que des cookies : tous les
 * `notification_channels.server_config` et `user_notification_channels.user_config`
 * devenaient d'un coup indéchiffrables, `decryptJson` LEVANT une exception de
 * tag AES-GCM sans message actionnable, et les notifications tombaient.
 *
 * Avec la clé précédente déclarée, la lecture retente avec elle : l'opérateur
 * garde une fenêtre pour tourner sans casser.
 */
function getKeys(): { current: Buffer; previous: Buffer | null } {
  if (cachedKeys) return cachedKeys;
  const salt = process.env.CHANNEL_ENCRYPTION_SALT || 'trackarr:channels:v1';
  const prev = process.env.CHANNEL_ENCRYPTION_KEY_PREVIOUS;
  cachedKeys = {
    current: deriveCurrent(),
    previous: prev && prev.length >= 32 ? (scryptSync(prev, salt, 32) as Buffer) : null,
  };
  return cachedKeys;
}

function deriveCurrent(): Buffer {
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
  return encrypt(json, getKeys().current);
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
  const keys = getKeys();
  try {
    return JSON.parse(decrypt(blob, keys.current)) as T;
  } catch (err) {
    // La clé précédente, quand l'opérateur en a déclaré une. Sans ce chemin,
    // faire tourner `NUXT_SESSION_SECRET` rendait indéchiffrable la
    // configuration de TOUS les canaux, avec pour seul symptôme une exception
    // de tag AES-GCM.
    if (keys.previous) {
      try {
        return JSON.parse(decrypt(blob, keys.previous)) as T;
      } catch {
        /* ni l'une ni l'autre : on relaie l'erreur d'origine ci-dessous */
      }
    }
    throw new Error(
      '[channelSecrets] Could not decrypt a channel config. The key changed ' +
        'without CHANNEL_ENCRYPTION_KEY_PREVIOUS being set, or ' +
        'CHANNEL_ENCRYPTION_SALT was altered. ' +
        `(${(err as Error).message})`
    );
  }
}

/**
 * Test helper — surfaces a clear error when the deployment forgot to
 * set a secret. The admin "Test" endpoint calls this before touching
 * the row so the UI shows the misconfig before garbage is written.
 */
export function assertChannelEncryptionReady(): void {
  getKeys();
}
