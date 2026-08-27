import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import { eraseAccount } from '../../utils/account/eraseAccount';
import { readBanStatusCached } from '../../utils/adminAuth';
import {
  ensureFederationIdentity,
  getFederationConfig,
} from '../../utils/federation/config';
import { didKeyFromPublicKey } from '../../utils/federation/did';

// GDPR erasure on a private tracker: the person goes, their contributions stay.
// The two halves that matter — the account can no longer be used, and the
// federated identity is withdrawn from the mesh — are asserted separately.

async function makePeer(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    status: 'active',
    sharesWithThem: { catalog: true, social: true, accounts: true, swarm: false },
    acceptsFromThem: { catalog: true, social: true, accounts: true, swarm: false },
  });
  return id;
}

describe('account erasure', () => {
  it('anonymizes the row, drops personal rows, and refuses the account after', async () => {
    const userId = await makeUser({
      displayName: 'Alice',
      bio: 'hello',
      lastIp: '203.0.113.7',
      totpSecret: 'SEKRET',
      totpEnabled: true,
    });
    const [beforeRow] = await db
      .select({ passkey: schema.users.passkey })
      .from(schema.users)
      .where(eq(schema.users.id, userId));

    await db
      .insert(schema.userSigningKeys)
      .values({ did: `did:key:z${userId.slice(0, 8)}`, userId, publicKey: 'PK' });

    const peerId = await makePeer();
    await db.insert(schema.federatedIdentities).values({
      id: randomUUID(),
      localUserId: userId,
      peerId,
      remoteUsername: 'alice@partner',
      status: 'verified',
      method: 'key',
      subjectDid: `did:key:z${userId.slice(0, 8)}`,
      verifiedAt: new Date(),
    });

    const other = await makeUser();
    await db
      .insert(schema.userFollows)
      .values({ followerId: userId, followingId: other });

    // Warm the auth cache to 'ok' so we also prove the erasure invalidates it.
    expect(await readBanStatusCached(userId)).toBe('ok');

    const result = await eraseAccount(userId);
    expect(result.keysRevoked).toBe(1);

    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    expect(u.username).toBe(`deleted-${userId}`);
    expect(u.displayName).toBeNull();
    expect(u.bio).toBeNull();
    expect(u.lastIp).toBeNull();
    expect(u.totpSecret).toBeNull();
    expect(u.totpEnabled).toBe(false);
    expect(u.deletedAt).not.toBeNull();
    expect(u.passkey).not.toBe(beforeRow!.passkey); // announce secret rotated

    const [key] = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.userId, userId));
    expect(key!.revokedAt).not.toBeNull();

    const fed = await db
      .select()
      .from(schema.federatedIdentities)
      .where(eq(schema.federatedIdentities.localUserId, userId));
    expect(fed.length).toBe(0);

    const follows = await db
      .select()
      .from(schema.userFollows)
      .where(eq(schema.userFollows.followerId, userId));
    expect(follows.length).toBe(0);

    // The gate now reads 'gone' — the cache was invalidated, so this hits the DB.
    expect(await readBanStatusCached(userId)).toBe('gone');
  });

  it('retracts the federated identity: mints a revocation and retires the record', async () => {
    await ensureFederationIdentity();
    await db.update(schema.federationConfig).set({ enabled: true });
    const config = await getFederationConfig();
    const issuer = didKeyFromPublicKey(config!.publicKey!);

    const userId = await makeUser();
    const did = `did:key:z${userId.slice(0, 8)}`;
    await db
      .insert(schema.userSigningKeys)
      .values({ did, userId, publicKey: 'PK' });

    // A live identity assertion about this member, as the sweep would have made.
    await db.insert(schema.catalogRecords).values({
      id: `sha256:${'a'.repeat(64)}`,
      torrentId: userId,
      issuer,
      kind: 'identity',
      origin: 'local',
      body: {},
      contentHash: `sha256:seed-${userId.slice(0, 8)}`,
    });

    await eraseAccount(userId);

    // The key is revoked and a revocation record now stands for its DID —
    // partners honour it by tearing down everything the DID proved.
    const [key] = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.did, did));
    expect(key!.revokedAt).not.toBeNull();

    const revs = await db
      .select()
      .from(schema.catalogRecords)
      .where(
        and(
          eq(schema.catalogRecords.kind, 'revocation'),
          eq(schema.catalogRecords.torrentId, did),
        ),
      );
    expect(revs.length).toBeGreaterThan(0);

    // The identity assertion is retired, not merely left to go stale.
    const [idrec] = await db
      .select()
      .from(schema.catalogRecords)
      .where(
        and(
          eq(schema.catalogRecords.kind, 'identity'),
          eq(schema.catalogRecords.torrentId, userId),
        ),
      );
    expect(idrec!.supersededAt).not.toBeNull();
  });
});
