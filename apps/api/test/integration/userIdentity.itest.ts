import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  adoptUserKey,
  ensureUserDid,
  ensureUserDids,
  getUserPrivateKeyPem,
  hasCustody,
} from '../../utils/federation/userIdentity';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { signIdentity, verifyIdentity } from '../../utils/federation/identityDoc';
import {
  ensureFederationIdentity,
  getPrivateKeyPem,
} from '../../utils/federation/config';

// A member's key, at rest and on the way out.
//
// The unit tests cover the identity document against keys held in memory. What
// can only be checked here is the round trip through Postgres: the private key
// is encrypted at rest, and a key that comes back subtly different from the
// one that went in produces a document that verifies nowhere — which is the
// kind of failure that shows up as "the other instance says my export is
// invalid" and nothing more.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

/** A partner to hang a link off, so the link has somewhere to be dropped from. */
async function makePeerRow(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: keypair().publicKeyPem,
    displayName: 'Alpha',
    status: 'active',
  });
  return id;
}

async function makeUser(username = 'Nova'): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.users).values({
    id,
    username,
    authSalt: 'salt',
    authVerifier: 'verifier',
    passkey: randomUUID().replace(/-/g, ''),
  });
  return id;
}

beforeEach(async () => {
  await ensureFederationIdentity();
});

describe('a member key', () => {
  it('is minted once and then answered from storage', async () => {
    const user = await makeUser();
    const first = await ensureUserDid(user);
    const second = await ensureUserDid(user);

    expect(first).toBe(second);
    expect(first).toMatch(/^did:key:z6Mk/);
    expect(
      await db
        .select()
        .from(schema.userSigningKeys)
        .where(eq(schema.userSigningKeys.userId, user)),
    ).toHaveLength(1);
  });

  it('names the key it actually stored', async () => {
    // The DID IS the public key. If the two ever drift apart, every signature
    // this member makes verifies against a key nobody can find.
    const user = await makeUser();
    const did = await ensureUserDid(user);
    const [row] = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.userId, user));

    expect(didKeyFromPublicKey(row!.publicKey)).toBe(did);
  });

  it('survives the encryption at rest', async () => {
    const user = await makeUser();
    const did = await ensureUserDid(user);

    const keys = await getUserPrivateKeyPem(user);
    expect(keys!.did).toBe(did);
    expect(keys!.privateKeyPem).toContain('BEGIN PRIVATE KEY');
    // The decrypted private key must still match the public one it was made
    // with — checked by signing something and verifying it against the DID.
    const doc = signIdentity(
      {
        did,
        username: 'Nova',
        instanceUrl: 'https://alpha.example',
        instanceDid: did, // stands in; the endorsement is checked elsewhere
      },
      {
        subjectPrivateKeyPem: keys!.privateKeyPem,
        instancePrivateKeyPem: keys!.privateKeyPem,
      },
    );
    const v = verifyIdentity(doc);
    expect(v.ok).toBe(true);
    expect(v.subject).toBe(did);
  });

  it('gives concurrent callers the same key, not two', async () => {
    // Two mints racing for one member would each generate a keypair; only one
    // insert can land, and whichever does is the one that stands. A caller
    // that returned its own losing key would sign with something the database
    // has never heard of.
    const user = await makeUser();
    const dids = await Promise.all(
      Array.from({ length: 8 }, () => ensureUserDid(user)),
    );

    expect(new Set(dids).size).toBe(1);
    expect(
      await db
        .select()
        .from(schema.userSigningKeys)
        .where(eq(schema.userSigningKeys.userId, user)),
    ).toHaveLength(1);
  });

  it('mints a batch in one pass and leaves existing keys alone', async () => {
    const a = await makeUser('A');
    const b = await makeUser('B');
    const known = await ensureUserDid(a);

    const map = await ensureUserDids([a, b, null, a]);

    expect(map.get(a)).toBe(known);
    expect(map.get(b)).toMatch(/^did:key:z6Mk/);
    expect(map.size).toBe(2);
  });

  it('says nothing rather than provisioning when merely asked', async () => {
    // Reading whether a key exists must not be what creates one, or "does
    // this member have an identity" becomes "give this member an identity".
    const user = await makeUser();
    expect(await getUserPrivateKeyPem(user)).toBeNull();
    expect(await db.select().from(schema.userSigningKeys)).toHaveLength(0);
  });
});

describe('the export a member walks away with', () => {
  it('is endorsed by this instance, and says by whom', async () => {
    const user = await makeUser();
    const did = await ensureUserDid(user);
    const keys = await getUserPrivateKeyPem(user);
    const config = await ensureFederationIdentity();
    const instanceDid = didKeyFromPublicKey(config.publicKey!);

    const doc = signIdentity(
      {
        did,
        username: 'Nova',
        instanceUrl: config.publicUrl ?? 'https://alpha.example',
        instanceDid,
      },
      {
        subjectPrivateKeyPem: keys!.privateKeyPem,
        instancePrivateKeyPem: getPrivateKeyPem(config)!,
      },
    );

    const v = verifyIdentity(doc);
    expect(v.ok).toBe(true);
    expect(v.subject).toBe(did);
    expect(v.username).toBe('Nova');
    // The half that carries the weight: without it the claim is "I hold a key
    // and I say I am Nova", which anybody can manufacture.
    expect(v.endorsedBy).toBe(instanceDid);
  });

  it('goes with the member when their account is deleted', async () => {
    // The key is theirs; the row is ours. Deleting the account takes the row
    // with it — which is right — and is exactly why the export has to have
    // happened first. Pinning it so nobody later "fixes" the cascade into
    // something that outlives the member's ability to ask for it.
    const user = await makeUser();
    await ensureUserDid(user);
    await db.delete(schema.users).where(eq(schema.users.id, user));

    expect(await db.select().from(schema.userSigningKeys)).toHaveLength(0);
  });
});

describe('a key the instance does not hold', () => {
  it('stops the instance being able to sign as the member', async () => {
    // The whole of custody, in one assertion. Before: we could produce their
    // subject proof, so every "I am Nova" a partner accepted was our word
    // twice over. After: there is nothing here to sign with.
    const user = await makeUser();
    await ensureUserDid(user);
    expect(await getUserPrivateKeyPem(user)).not.toBeNull();

    const { publicKeyPem, did } = keypair();
    await adoptUserKey(user, did, publicKeyPem);

    expect(await hasCustody(user)).toBe(true);
    expect(await getUserPrivateKeyPem(user)).toBeNull();
    expect(await ensureUserDid(user)).toBe(did);
  });

  it('retires the old key with a succession, not a deletion', async () => {
    // Their catalogue is attributed to the old identifier. Taking custody must
    // not cost them the work they published before they did.
    const user = await makeUser();
    const old = await ensureUserDid(user);
    const { publicKeyPem, did } = keypair();

    await adoptUserKey(user, did, publicKeyPem);

    const [retired] = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.did, old));
    expect(retired!.revokedAt).toBeTruthy();
    expect(retired!.succeededBy).toBe(did);
  });

  it('drops the links proven with the key we used to hold', async () => {
    // Those were proven with a key this server could sign with. Re-proving
    // from a key only they hold is the point, not an inconvenience.
    const user = await makeUser();
    await ensureUserDid(user);
    await db.insert(schema.federatedIdentities).values({
      id: randomUUID(),
      localUserId: user,
      peerId: await makePeerRow(),
      remoteUsername: 'Nova',
      status: 'verified',
      method: 'key',
      subjectDid: 'did:key:z6MkSomewhereElse',
      verifiedAt: new Date(),
    });

    const { publicKeyPem, did } = keypair();
    await adoptUserKey(user, did, publicKeyPem);

    expect(
      await db
        .select()
        .from(schema.federatedIdentities)
        .where(eq(schema.federatedIdentities.localUserId, user)),
    ).toHaveLength(0);
  });

  it('refuses to re-adopt a key it has already retired', async () => {
    // Retiring a key mints a withdrawal that propagates to every partner and is
    // never un-said, so bringing the key back locally would leave the local and
    // federated views permanently disagreeing — the member signing under a
    // key partners refuse. A member who wants a key again makes a fresh one.
    const user = await makeUser();
    const { publicKeyPem, did } = keypair();
    await adoptUserKey(user, did, publicKeyPem);

    const other = keypair();
    await adoptUserKey(user, other.did, other.publicKeyPem); // retires `did`

    await expect(adoptUserKey(user, did, publicKeyPem)).rejects.toThrow(/revoked/i);
    // The current identity is unchanged — the refused re-adoption did nothing.
    expect(await ensureUserDid(user)).toBe(other.did);
  });

  it('is a no-op when the member already holds that exact key', async () => {
    const user = await makeUser();
    const { publicKeyPem, did } = keypair();
    await adoptUserKey(user, did, publicKeyPem);

    const again = await adoptUserKey(user, did, publicKeyPem);
    expect(again.previous).toBeNull();
    expect(
      await db
        .select()
        .from(schema.userSigningKeys)
        .where(eq(schema.userSigningKeys.userId, user)),
    ).toHaveLength(1);
  });
});

describe('two mints landing at once', () => {
  // The guarantee is "one live key per member", and it is held by an index —
  // `user_signing_keys_current`, partial unique over `(user_id) WHERE
  // revoked_at IS NULL`. This is the test that says so, because both halves
  // of it were wrong at once and neither announced itself.
  //
  // `drizzle-kit push` never created that index, so every push-maintained
  // database was without it: two concurrent mints generate two DIFFERENT
  // keypairs, collide on nothing, and a member ends up with two live keys.
  // Restoring the index under the migration chain then turned that silence
  // into a thrown unique violation, because the conflict clause named the
  // primary key and cannot absorb a violation of a different index.

  it('leaves the member with exactly one live key', async () => {
    const userId = await makeUser('Racer');

    const dids = await Promise.all(
      Array.from({ length: 5 }, () => ensureUserDid(userId)),
    );

    // Every caller comes back with the same answer, not just without throwing.
    expect(new Set(dids).size).toBe(1);

    const live = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.userId, userId));
    expect(live.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });

  it('is the index enforcing it, not luck', async () => {
    // Written the other way round: insert a second live key by hand and
    // require the database to refuse it. Without this, the test above passes
    // on any database where the timing happens not to overlap.
    const userId = await makeUser('Twice');
    await ensureUserDid(userId);

    await expect(
      db.insert(schema.userSigningKeys).values({
        did: 'did:key:zSecondLiveKey',
        userId,
        publicKey: 'pem',
        privateKeyEnc: null,
      }),
    ).rejects.toThrow();
  });

  it('lets a retired key be replaced', async () => {
    // The index must not forbid succession, or rotating would be impossible.
    const userId = await makeUser('Rotator');
    const first = await ensureUserDid(userId);
    await db
      .update(schema.userSigningKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.userSigningKeys.did, first));

    const second = await ensureUserDid(userId);
    expect(second).not.toBe(first);

    const rows = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.userId, userId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.revokedAt === null)).toHaveLength(1);
  });
});

describe('a revoked identifier cannot be re-adopted', () => {
  // Revocation exists for the leaked key. Bringing it back to life locally,
  // while every partner keeps refusing it because the Undo already propagated,
  // is exactly the divergence revocation is meant to prevent.
  it('refuses adoption of a DID whose key is revoked', async () => {
    const userId = await makeUser('Leaky');
    const did = await ensureUserDid(userId);
    await db
      .update(schema.userSigningKeys)
      .set({ revokedAt: new Date() })
      .where(eq(schema.userSigningKeys.did, did));

    await expect(adoptUserKey(userId, did, 'pem')).rejects.toThrow(/revoked/i);
  });
});
