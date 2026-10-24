/**
 * Re-encrypts the account secrets that are not under the current key yet:
 * login verifiers and TOTP seeds still in plaintext from before encryption at
 * rest, and values readable only through `CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`.
 *
 * Those used to move only when their owner next logged in. A dormant account
 * therefore kept its verifier in clear — and the verifier is the credential:
 * a database dump alone was enough to sign in as that member, the very thing
 * encryption at rest was added to stop (SECURITY-REVIEW.md, H1). A key rotation
 * waited on the same logins before the previous key could be dropped.
 *
 * The cursor is keyed on the current key's check value, so a rotation starts a
 * fresh walk on its own. Each write is conditional on the value it read, so a
 * password change or a TOTP enrolment landing in between is never overwritten.
 * Suspended during panic: panic ciphertext has the same `iv:ct:tag` shape, and
 * re-encrypting it under another key would leave the restore nothing to
 * decrypt.
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, gt } from 'drizzle-orm';
import {
  decryptSecret,
  encryptSecret,
  encryptSecretRequired,
  keyCheckValue,
  needsRewrite,
} from '~~/utils/credentialSecrets';
import { getSetting, setSetting } from '~~/utils/server';
import { panicActive } from '~~/utils/panicLock';

const BATCH_SIZE = 500;

export function rewrapCursorKey(): string {
  return `credential_rewrap_cursor:${keyCheckValue()}`;
}

/** One batch of the sweep. Exported for the integration suite. */
export async function rewrapCredentialsTick(): Promise<{ processed: number; rewritten: number }> {
  if (await panicActive()) return { processed: 0, rewritten: 0 };
  const cursorKey = rewrapCursorKey();
  const cursor = (await getSetting(cursorKey)) ?? '';

  const rows = await db
    .select({
      id: schema.users.id,
      authVerifier: schema.users.authVerifier,
      totpSecret: schema.users.totpSecret,
    })
    .from(schema.users)
    .where(gt(schema.users.id, cursor))
    .orderBy(asc(schema.users.id))
    .limit(BATCH_SIZE);

  if (!rows.length) return { processed: 0, rewritten: 0 };

  let rewritten = 0;
  for (const row of rows) {
    if (row.authVerifier && needsRewrite(row.authVerifier)) {
      const plain = decryptSecret(row.authVerifier);
      // Null: under no key this instance holds. Left alone — the login fails
      // closed on it already, and rewriting it would destroy the evidence.
      if (plain) {
        await db
          .update(schema.users)
          .set({ authVerifier: encryptSecretRequired(plain) })
          .where(and(eq(schema.users.id, row.id), eq(schema.users.authVerifier, row.authVerifier)));
        rewritten += 1;
      }
    }
    if (row.totpSecret && needsRewrite(row.totpSecret)) {
      const plain = decryptSecret(row.totpSecret);
      if (plain) {
        await db
          .update(schema.users)
          .set({ totpSecret: encryptSecret(plain) })
          .where(and(eq(schema.users.id, row.id), eq(schema.users.totpSecret, row.totpSecret)));
        rewritten += 1;
      }
    }
  }

  await setSetting(cursorKey, rows[rows.length - 1]!.id);
  return { processed: rows.length, rewritten };
}
