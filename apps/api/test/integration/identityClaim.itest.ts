import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { signIdentity } from '../../utils/federation/identityDoc';
import { checkClaim, recordClaim } from '../../utils/federation/identityClaim';

// "I was Nova on that instance", proven rather than asserted.
//
// One thing carries the security of this whole feature and it is easy to get
// wrong in a way that looks generous: **the endorsement has to come from a
// partner we actually federate with, matched on its KEY.** Anybody can be an
// instance. Ten minutes with a keypair buys a document saying you were the top
// uploader on a tracker you have never seen — and if that document is
// displayed at all, somebody will read it as verified.
//
// So the tests are mostly about refusals, and each one is a way the check
// could be too generous rather than a way it could crash.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

let partner: ReturnType<typeof keypair>;
let member: ReturnType<typeof keypair>;
let peerId: string;

async function makePeer(
  keys: { publicKeyPem: string },
  over: Partial<typeof schema.federationPeers.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: keys.publicKeyPem,
    displayName: 'Alpha',
    status: 'active',
    sharesWithThem: { catalog: true, social: true, accounts: true, swarm: false },
    acceptsFromThem: { catalog: true, social: true, accounts: true, swarm: false },
    ...over,
  });
  return id;
}

async function makeUser(username = 'Local'): Promise<string> {
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

/** A document as the partner's export endpoint would have produced it. */
function exported(over: Partial<Parameters<typeof signIdentity>[0]> = {}, keys = {
  subjectPrivateKeyPem: member.privateKeyPem,
  instancePrivateKeyPem: partner.privateKeyPem,
}) {
  return signIdentity(
    {
      did: member.did,
      username: 'Nova',
      instanceUrl: 'https://alpha.example',
      instanceDid: partner.did,
      issuedAt: new Date('2026-08-22T10:00:00.000Z'),
      ...over,
    },
    keys,
  );
}

async function linksOf(userId: string) {
  return db
    .select()
    .from(schema.federatedIdentities)
    .where(eq(schema.federatedIdentities.localUserId, userId));
}

beforeEach(async () => {
  partner = keypair();
  member = keypair();
  peerId = await makePeer(partner);
});

describe('a claim we can act on', () => {
  it('links the two accounts and says how it was proven', async () => {
    const user = await makeUser();

    const out = await recordClaim(user, exported());

    expect(out.ok).toBe(true);
    expect(out.peerId).toBe(peerId);
    expect(out.remoteUsername).toBe('Nova');

    const [link] = await linksOf(user);
    expect(link!.status).toBe('verified');
    expect(link!.method).toBe('key');
    expect(link!.subjectDid).toBe(member.did);
    // Nothing to paste anywhere: a leftover code would be a live credential
    // for the flow this one replaces.
    expect(link!.verifyCode).toBeNull();
    expect(link!.verifiedAt).toBeTruthy();
  });

  it('needs no help from the partner and no network', async () => {
    // The point of the whole step. The partner is unreachable — suspended
    // here, shut down out there, whatever — and the claim still checks out
    // because everything needed is inside the document.
    //
    // Suspended is a different thing and IS refused, so the peer stays active
    // and simply never gets asked: no signedGet is mocked in this file, so a
    // request would fail the test by trying to leave.
    const user = await makeUser();
    expect((await recordClaim(user, exported())).ok).toBe(true);
  });

  it('is idempotent — the same document twice is one link', async () => {
    const user = await makeUser();
    await recordClaim(user, exported());
    await recordClaim(user, exported());

    expect(await linksOf(user)).toHaveLength(1);
  });

  it('upgrades a link the member had already proven by bio', async () => {
    // The older path leaves a verified row with a code and no DID. Presenting
    // a document must move it to the stronger footing rather than sitting
    // beside it as a second, contradictory link.
    const user = await makeUser();
    await db.insert(schema.federatedIdentities).values({
      id: randomUUID(),
      localUserId: user,
      peerId,
      remoteUsername: 'Nova',
      status: 'verified',
      method: 'bio',
      verifyCode: 'STALE-CODE',
    });

    await recordClaim(user, exported());

    const links = await linksOf(user);
    expect(links).toHaveLength(1);
    expect(links[0]!.method).toBe('key');
    expect(links[0]!.subjectDid).toBe(member.did);
    expect(links[0]!.verifyCode).toBeNull();
  });
});

describe('a claim we must not act on', () => {
  it('refuses an endorsement from an instance we do not federate with', async () => {
    // The one that matters. Anybody can be an instance; a document endorsed
    // by a stranger proves only that a stranger vouched.
    const stranger = keypair();
    const doc = exported({ instanceDid: stranger.did }, {
      subjectPrivateKeyPem: member.privateKeyPem,
      instancePrivateKeyPem: stranger.privateKeyPem,
    });

    const out = await checkClaim(doc);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/does not federate/i);
  });

  it('matches the endorser on its key, not on the URL in the document', async () => {
    // A URL is a string the document chose. Trusting it would let a stranger
    // endorse a claim and simply write a partner's address into the file.
    const stranger = keypair();
    const doc = signIdentity(
      {
        did: member.did,
        username: 'Nova',
        // Points at the real partner...
        instanceUrl: `https://p-${peerId.slice(0, 8)}.example`,
        // ...but is endorsed by somebody else entirely.
        instanceDid: stranger.did,
        issuedAt: new Date('2026-08-22T10:00:00.000Z'),
      },
      {
        subjectPrivateKeyPem: member.privateKeyPem,
        instancePrivateKeyPem: stranger.privateKeyPem,
      },
    );

    expect((await checkClaim(doc)).ok).toBe(false);
  });

  it('refuses a claim with no endorsement at all', async () => {
    const doc = exported();
    delete doc['trackarr:endorsement'];

    const out = await checkClaim(doc);
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not endorsed/i);
  });

  it('refuses a claim endorsed by a partner that is no longer active', async () => {
    await db
      .update(schema.federationPeers)
      .set({ status: 'suspended' })
      .where(eq(schema.federationPeers.id, peerId));

    const out = await checkClaim(exported());
    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/not active/i);
  });

  it('refuses a document edited after it was signed', async () => {
    const doc = exported();
    doc.preferredUsername = 'SomebodyElse';

    expect((await checkClaim(doc)).ok).toBe(false);
  });

  it('refuses to move an established link to a second account', async () => {
    // Whoever holds the file can present it, so a silent takeover is the
    // worse of the two failures. An operator can unpick a genuine dispute;
    // nobody can unpick one they were never told about.
    const first = await makeUser('First');
    const second = await makeUser('Second');
    await recordClaim(first, exported());

    const out = await recordClaim(second, exported());

    expect(out.ok).toBe(false);
    expect(out.reason).toMatch(/another account/i);
    expect(await linksOf(second)).toHaveLength(0);
    expect((await linksOf(first))[0]!.subjectDid).toBe(member.did);
  });

  it('lets one member hold names on two partners', async () => {
    // The refusal above is about one identity and two accounts. The reverse —
    // one account, two identities — is the ordinary case and must still work.
    const other = keypair();
    const otherPeer = await makePeer(other, { displayName: 'Beta' });
    const user = await makeUser();

    await recordClaim(user, exported());
    await recordClaim(
      user,
      signIdentity(
        {
          did: member.did,
          username: 'NovaThere',
          instanceUrl: 'https://beta.example',
          instanceDid: other.did,
          issuedAt: new Date('2026-08-22T10:00:00.000Z'),
        },
        {
          subjectPrivateKeyPem: member.privateKeyPem,
          instancePrivateKeyPem: other.privateKeyPem,
        },
      ),
    );

    const links = await linksOf(user);
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.peerId))).toEqual(
      new Set([peerId, otherPeer]),
    );
  });

  it('never throws on whatever it is handed', async () => {
    for (const input of [null, undefined, 42, 'a string', [], {}, { type: 'Person' }]) {
      const out = await checkClaim(input);
      expect(out.ok, JSON.stringify(input)).toBe(false);
      expect(typeof out.reason).toBe('string');
    }
  });
});

describe('what a link is worth once it exists', () => {
  it('records the DID, so the same person is recognisable later', async () => {
    // A username can be reassigned on the partner. The DID cannot, which is
    // why the link is keyed on it and not on the name.
    const user = await makeUser();
    await recordClaim(user, exported());

    const [link] = await db
      .select()
      .from(schema.federatedIdentities)
      .where(
        and(
          eq(schema.federatedIdentities.peerId, peerId),
          eq(schema.federatedIdentities.subjectDid, member.did),
        ),
      );
    expect(link!.localUserId).toBe(user);
  });
});
