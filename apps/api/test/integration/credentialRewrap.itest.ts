import { describe, it, expect, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { rewrapCredentialsTick, rewrapCursorKey } from '../../utils/credentialRewrap';
import {
  decryptSecret,
  encryptSecretRequired,
  looksEncrypted,
} from '../../utils/credentialSecrets';
import { setSetting } from '../../utils/settings';
import { invalidatePanicCache } from '../../utils/panicLock';
import { makeUser } from './helpers';

// Account secrets left in plaintext — or readable only through the previous
// key — used to wait for their owner's next login to be re-encrypted. A dormant
// account's verifier, the credential itself, sat in clear in every dump.

async function secretsOf(id: string) {
  const [row] = await db
    .select({ authVerifier: schema.users.authVerifier, totpSecret: schema.users.totpSecret })
    .from(schema.users)
    .where(eq(schema.users.id, id));
  return row!;
}

describe('rewrapCredentialsTick', () => {
  beforeEach(async () => {
    await setSetting(rewrapCursorKey(), '');
  });

  it('encrypts plaintext verifiers and TOTP seeds, and leaves encrypted ones be', async () => {
    const legacy = await makeUser({
      authVerifier: 'cGxhaW50ZXh0LXZlcmlmaWVyLWZyb20tYmVmb3Jl',
      totpSecret: 'JBSWY3DPEHPK3PXP',
    });
    const encrypted = encryptSecretRequired('YWxyZWFkeS1lbmNyeXB0ZWQ=');
    const current = await makeUser({ authVerifier: encrypted });

    const r = await rewrapCredentialsTick();
    expect(r.rewritten).toBe(2);

    const after = await secretsOf(legacy);
    expect(looksEncrypted(after.authVerifier)).toBe(true);
    expect(decryptSecret(after.authVerifier)).toBe('cGxhaW50ZXh0LXZlcmlmaWVyLWZyb20tYmVmb3Jl');
    expect(looksEncrypted(after.totpSecret)).toBe(true);
    expect(decryptSecret(after.totpSecret)).toBe('JBSWY3DPEHPK3PXP');

    expect((await secretsOf(current)).authVerifier).toBe(encrypted);

    // The walk is done: nothing left to do.
    expect((await rewrapCredentialsTick()).processed).toBe(0);
  });

  it('stands still during a panic — its ciphertext has the same shape', async () => {
    const legacy = await makeUser({ authVerifier: 'cGxhaW4tZHVyaW5nLXBhbmlj' });
    await db
      .insert(schema.panicState)
      .values({ id: 'singleton', isEncrypted: true, phase: 'encrypted' })
      .onConflictDoUpdate({ target: schema.panicState.id, set: { isEncrypted: true, phase: 'encrypted' } });
    await invalidatePanicCache();

    expect(await rewrapCredentialsTick()).toEqual({ processed: 0, rewritten: 0 });
    expect((await secretsOf(legacy)).authVerifier).toBe('cGxhaW4tZHVyaW5nLXBhbmlj');
  });
});
