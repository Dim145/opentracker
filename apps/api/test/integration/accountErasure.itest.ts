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
import {
  forgetErasedUploaderRecords,
  mintRecords,
  type MintContext,
} from '../../utils/federation/catalogRecord';
import { ensureUserDid } from '../../utils/federation/userIdentity';

// GDPR erasure on a private tracker: the person goes, their contributions stay.
// The two halves that matter — the account can no longer be used, and the
// federated identity is withdrawn from the mesh — are asserted separately.

let torrentCounter = 0;

async function makeTorrent(uploaderId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.torrents).values({
    id,
    infoHash: (torrentCounter++).toString(16).padStart(40, 'e'),
    name: 'Show.S01E01.1080p.WEB-DL-NTb',
    size: 2_540_000_000,
    uploaderId,
    moderationStatus: 'accepted',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  });
  return id;
}

async function liveMintContext(): Promise<MintContext> {
  await ensureFederationIdentity();
  await db.update(schema.federationConfig).set({ enabled: true });
  const config = await getFederationConfig();
  const { getPrivateKeyPem } = await import('../../utils/federation/config');
  return {
    privateKeyPem: getPrivateKeyPem(config!)!,
    did: didKeyFromPublicKey(config!.publicKey!),
    publicUrl: 'https://alpha.example',
  };
}

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
    // A tombstone name, and deliberately NOT `deleted-<account id>`: that
    // published the internal primary key as a public username for no gain. The
    // shape is asserted here; the "not the id" part has its own test below.
    expect(u.username).toMatch(/^deleted-[0-9a-f]{24}$/);
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

  describe('the catalogue stops naming them', () => {
    it('re-mints the release without the uploader name or DID', async () => {
      // What erasure used to leave standing. The records were already signed
      // and carried `trackarr:uploaderName` plus the author DID, and were
      // served verbatim to any partner asking for them by id — so "a tombstone
      // nobody can trace back" was true of the join and false of the catalogue.
      const ctx = await liveMintContext();
      const userId = await makeUser({ displayName: 'Alice' });
      const [before] = await db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const torrentId = await makeTorrent(userId);

      await mintRecords([torrentId], ctx);
      const first = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.torrentId, torrentId));
      const firstBody = first[0]!.body as Record<string, unknown>;
      expect(firstBody['trackarr:uploaderName']).toBe(before!.username);
      expect(firstBody.attributedTo).toBeTruthy();

      await eraseAccount(userId);
      await mintRecords([torrentId], ctx);

      const rows = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.torrentId, torrentId));
      const live = rows.find((r) => r.supersededAt === null)!;
      const body = live.body as Record<string, unknown>;
      expect(live.id).not.toBe(first[0]!.id); // a new generation
      expect(body['trackarr:uploaderName']).toBeNull();
      expect(body.attributedTo).toBeNull();
      expect(JSON.stringify(body)).not.toContain(before!.username);
    });

    it('moves the releases forward so the forward-only sweep revisits them', async () => {
      // The sweep walks `coalesce(updated_at, created_at)` and never looks back,
      // so without this bump a record already minted keeps the member's name
      // forever — erasure changes the projection, not the torrent.
      const userId = await makeUser();
      const torrentId = await makeTorrent(userId);

      await eraseAccount(userId);

      const [t] = await db
        .select({ updatedAt: schema.torrents.updatedAt })
        .from(schema.torrents)
        .where(eq(schema.torrents.id, torrentId));
      expect(t!.updatedAt!.getTime()).toBeGreaterThan(
        new Date('2026-01-01T00:00:00Z').getTime(),
      );
    });

    it('deletes the generation that carried the name, once replaced', async () => {
      const ctx = await liveMintContext();
      const userId = await makeUser();
      const torrentId = await makeTorrent(userId);
      await mintRecords([torrentId], ctx);
      await eraseAccount(userId);
      await mintRecords([torrentId], ctx);

      expect(await forgetErasedUploaderRecords()).toBe(1);
      const rows = await db
        .select()
        .from(schema.catalogRecords)
        .where(eq(schema.catalogRecords.torrentId, torrentId));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.supersededAt).toBeNull();
    });

    it('never deletes the last thing we said about a release', async () => {
      // Deleting a lineage down to nothing would leave partners holding a
      // record this instance can no longer explain, replace or withdraw.
      const ctx = await liveMintContext();
      const userId = await makeUser();
      const torrentId = await makeTorrent(userId);
      await mintRecords([torrentId], ctx);
      // Erase, and supersede by hand WITHOUT minting a replacement.
      await eraseAccount(userId);
      await db
        .update(schema.catalogRecords)
        .set({ supersededAt: new Date() })
        .where(eq(schema.catalogRecords.torrentId, torrentId));

      expect(await forgetErasedUploaderRecords()).toBe(0);
    });

    it('does not mint a fresh signing key for an erased account', async () => {
      // The bug this pair of guards exists for: a moderator edits an erased
      // member's still-published torrent, the sweep asks for the uploader's
      // DID, finds no live key — and used to make one. The account had a live
      // federated identifier again, republished, with no `Undo` for it.
      const userId = await makeUser();
      await eraseAccount(userId);

      expect(await ensureUserDid(userId)).toBeNull();
      const keys = await db
        .select()
        .from(schema.userSigningKeys)
        .where(eq(schema.userSigningKeys.userId, userId));
      expect(keys.filter((k) => k.revokedAt === null)).toHaveLength(0);
    });

    it('clears the raw IP and User-Agent off the anti-cheat flags', async () => {
      const userId = await makeUser();
      await db.insert(schema.anticheatFlags).values({
        id: randomUUID(),
        userId,
        infoHash: 'f'.repeat(40),
        kind: 'ratio_spike',
        ip: '203.0.113.9',
        userAgent: 'qBittorrent/4.6.0',
      });

      await eraseAccount(userId);

      const [flag] = await db
        .select()
        .from(schema.anticheatFlags)
        .where(eq(schema.anticheatFlags.userId, userId));
      expect(flag).toBeTruthy(); // the finding survives…
      expect(flag!.ip).toBeNull(); // …the identifiers do not
      expect(flag!.userAgent).toBeNull();
    });

    it('gives the tombstone name a random suffix, not the account id', async () => {
      const userId = await makeUser();
      await eraseAccount(userId);

      const [row] = await db
        .select({ username: schema.users.username })
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      expect(row!.username.startsWith('deleted-')).toBe(true);
      expect(row!.username).not.toContain(userId);
    });
  });
});
