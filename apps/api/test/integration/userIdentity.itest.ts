import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  ensureUserDid,
  ensureUserDids,
  getUserPrivateKeyPem,
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
