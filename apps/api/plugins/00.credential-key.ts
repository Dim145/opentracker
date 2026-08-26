/**
 * Refuse to start when the credential encryption key has changed.
 *
 * `users.auth_verifier` and `users.totp_secret` are encrypted at rest under a
 * key derived from `CREDENTIAL_ENCRYPTION_KEY`, falling back to
 * `CHANNEL_ENCRYPTION_KEY` and then `NUXT_SESSION_SECRET`. That fallback is
 * what makes an upgrade seamless — but it also means rotating
 * `NUXT_SESSION_SECRET`, an operation that used to invalidate nothing but
 * session cookies, silently makes every credential undecryptable. The only
 * symptom would be every member being told "Invalid credentials" at once,
 * with a single line in the server log to explain it, and no way back.
 *
 * So the key's fingerprint is persisted the first time it is used and checked
 * on every boot after. A mismatch stops the container with an actionable
 * message instead of letting it serve a locked-out site: restoring the old
 * secret is a working recovery, and losing that window is not.
 *
 * The rotation itself stays possible — set `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`
 * to the old value and rows re-encrypt under the new key as their owners log
 * in. This plugin recognises that case and lets the boot proceed.
 */
import {
  keyCheckValue,
  usingInheritedKey,
  decryptSecret,
  looksEncrypted,
} from '~~/utils/credentialSecrets';
import { getSetting, setSetting } from '~~/utils/server';
import { db } from '@trackarr/db';
import { users } from '@trackarr/db/schema';
import { isNotNull, and, sql } from 'drizzle-orm';

const KCV_SETTING = 'credential_key_check';

export default defineNitroPlugin(async () => {
  let current: string;
  try {
    current = keyCheckValue();
  } catch (err) {
    console.error('[credential-key]', (err as Error).message);
    throw err;
  }

  if (usingInheritedKey()) {
    console.warn(
      '[credential-key] CREDENTIAL_ENCRYPTION_KEY is not set, so account secrets are encrypted under CHANNEL_ENCRYPTION_KEY / NUXT_SESSION_SECRET. That works, but it ties every member\'s ability to log in to a secret you may want to rotate for unrelated reasons. Pin a dedicated key: `openssl rand -hex 32`.',
    );
  }

  let stored: string | null = null;
  try {
    stored = await getSetting(KCV_SETTING);
  } catch (err) {
    // Database not reachable yet (first boot racing the migrations). Skip the
    // check rather than block startup — the next boot performs it.
    console.warn(
      '[credential-key] Could not read the key fingerprint, skipping the check this boot:',
      (err as Error).message,
    );
    return;
  }

  if (!stored) {
    // First boot with this feature. Record the fingerprint — but only claim it
    // if the key actually matches whatever is already encrypted in the table,
    // otherwise we would happily stamp a wrong key over an existing database.
    if (await encryptedRowsFailToDecrypt()) {
      fail(current, 'no fingerprint was recorded yet, but the rows already in the database do not decrypt under the current key');
    }
    await setSetting(KCV_SETTING, current);
    console.log('[credential-key] Key fingerprint recorded.');
    return;
  }

  if (stored === current) return;

  // Different key. Acceptable only if the rotation key covers the old one.
  if (process.env.CREDENTIAL_ENCRYPTION_KEY_PREVIOUS) {
    if (!(await encryptedRowsFailToDecrypt())) {
      console.warn(
        '[credential-key] The key changed and CREDENTIAL_ENCRYPTION_KEY_PREVIOUS decrypts the existing rows. Re-encryption happens as members log in; keep the previous key set until they all have, then remove it.',
      );
      await setSetting(KCV_SETTING, current);
      return;
    }
  }

  fail(current, `the recorded fingerprint is ${stored}`);
});

/**
 * Sample a few already-encrypted rows and report whether they are unreadable.
 * Cheap, and far more trustworthy than the fingerprint alone: it answers the
 * question the operator actually cares about — can we still read the data.
 */
async function encryptedRowsFailToDecrypt(): Promise<boolean> {
  try {
    const rows = await db
      .select({ v: users.authVerifier })
      .from(users)
      .where(and(isNotNull(users.authVerifier), sql`auth_verifier LIKE '%:%:%'`))
      .limit(5);
    if (rows.length === 0) return false; // nothing encrypted yet
    return rows.every((r) => looksEncrypted(r.v) && decryptSecret(r.v) === null);
  } catch {
    return false; // can't tell — don't block the boot on a query failure
  }
}

function fail(current: string, why: string): never {
  const message = [
    '[credential-key] REFUSING TO START: the credential encryption key changed.',
    `  Current key fingerprint: ${current}; ${why}.`,
    '',
    '  Account secrets (auth_verifier, totp_secret) are encrypted with this key.',
    '  Starting now would tell every member "Invalid credentials" with no way back.',
    '',
    '  Recover by ONE of:',
    '    1. Restore the previous CREDENTIAL_ENCRYPTION_KEY / CHANNEL_ENCRYPTION_KEY /',
    '       NUXT_SESSION_SECRET value (whichever one changed).',
    '    2. Keep the new key and set CREDENTIAL_ENCRYPTION_KEY_PREVIOUS to the old',
    '       value — rows re-encrypt as their owners log in.',
    '    3. If the old value is genuinely lost, every member must reset their',
    '       password and re-enrol TOTP; delete the',
    `       "${KCV_SETTING}" settings row to acknowledge that.`,
  ].join('\n');
  console.error(message);
  // `throw` is not enough: Nitro turns a plugin rejection into an
  // unhandledRejection and carries on serving, which is the worst outcome —
  // a site that is up and tells every member their password is wrong. Exit,
  // and let the restart policy make the failure loud and visible.
  process.exit(1);
}
