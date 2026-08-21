import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { signIdentity } from '../../utils/federation/identityDoc';
import { recordClaim } from '../../utils/federation/identityClaim';
import {
  aliasesOf,
  identitiesOfUser,
  ingestIdentityRecord,
  ingestRevocation,
  mintIdentityRecords,
  mintRevocations,
} from '../../utils/federation/identityRecord';
import { verifyRecord } from '../../utils/federation/record';
import {
  ensureUserDid,
  getUserPrivateKeyPem,
  rotateUserKey,
} from '../../utils/federation/userIdentity';
import type { MintContext } from '../../utils/federation/catalogRecord';

// Publishing "our member is also that person elsewhere".
//
// The claim step let a member prove, to us, that they were somebody on a
// partner. That proof then helped nobody: the partner does not know, the other
// partners do not know, and one person's work stays two unrelated bodies of
// work. This publishes the link so it reconciles and relays like anything else
// — which matters precisely when the instance holding the old account is gone.
//
// Two properties carry it. The identifiers stay DISTINCT and the relation is
// what travels, so nothing is ever signed under a key we do not hold. And the
// evidence travels with the assertion, so a third instance can check the link
// instead of believing whoever relayed it.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

let us: ReturnType<typeof keypair>;
let partner: ReturnType<typeof keypair>;
let member: ReturnType<typeof keypair>;
let peerId: string;
let ctx: MintContext;

async function makePeer(keys: { publicKeyPem: string }, name = 'Alpha') {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: keys.publicKeyPem,
    displayName: name,
    status: 'active',
    sharesWithThem: { catalog: true, social: true, accounts: true, swarm: false },
    acceptsFromThem: { catalog: true, social: true, accounts: true, swarm: false },
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

function exportedFrom(
  instance: ReturnType<typeof keypair>,
  subject: ReturnType<typeof keypair>,
  username = 'Nova',
) {
  return signIdentity(
    {
      did: subject.did,
      username,
      instanceUrl: 'https://alpha.example',
      instanceDid: instance.did,
      issuedAt: new Date('2026-08-22T10:00:00.000Z'),
    },
    {
      subjectPrivateKeyPem: subject.privateKeyPem,
      instancePrivateKeyPem: instance.privateKeyPem,
    },
  );
}

async function liveIdentityRecords() {
  return db
    .select()
    .from(schema.catalogRecords)
    .where(
      and(
        eq(schema.catalogRecords.kind, 'identity'),
        isNull(schema.catalogRecords.supersededAt),
      ),
    );
}

beforeEach(async () => {
  us = keypair();
  partner = keypair();
  member = keypair();
  peerId = await makePeer(partner);
  ctx = { privateKeyPem: us.privateKeyPem, did: us.did, publicUrl: 'https://us.example' };
});

describe('what this instance publishes about its members', () => {
  it('says nothing about a member who has proven nothing', async () => {
    await makeUser();
    expect(await mintIdentityRecords(ctx)).toEqual({ minted: 0, withdrawn: 0 });
    expect(await liveIdentityRecords()).toHaveLength(0);
  });

  it('publishes the link, with the document that proved it', async () => {
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));

    expect((await mintIdentityRecords(ctx)).minted).toBe(1);

    const [rec] = await liveIdentityRecords();
    const body = rec!.body as Record<string, unknown>;
    expect(body.type).toBe('Person');
    expect(body['trackarr:subject']).toBe(await ensureUserDid(user));
    expect(body.alsoKnownAs).toEqual([member.did]);
    // The difference between "we say so" and "anybody can check".
    expect(Array.isArray(body['trackarr:evidence'])).toBe(true);
    expect(verifyRecord(body).ok).toBe(true);
  });

  it('never signs under an identifier it does not hold the key for', async () => {
    // The reason this is an assertion and not a re-attribution. The record is
    // signed by US, about the member, naming the other identifier — the
    // partner's key is nowhere in the signature.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));
    await mintIdentityRecords(ctx);

    const [rec] = await liveIdentityRecords();
    const v = verifyRecord(rec!.body);
    expect(v.signer).toBe(us.did);
    expect(v.signer).not.toBe(member.did);
  });

  it('mints nothing on a second sweep over unchanged links', async () => {
    // The content address covers everything in the body, so anything that
    // varies between two sweeps republishes the record forever. The timestamp
    // is the newest verification, not `now`, precisely for this.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));
    await mintIdentityRecords(ctx);

    expect(await mintIdentityRecords(ctx)).toEqual({ minted: 0, withdrawn: 0 });
    expect(await mintIdentityRecords(ctx)).toEqual({ minted: 0, withdrawn: 0 });
    expect(await liveIdentityRecords()).toHaveLength(1);
  });

  it('supersedes rather than accumulates when a second link is proven', async () => {
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));
    await mintIdentityRecords(ctx);
    const [first] = await liveIdentityRecords();

    const other = keypair();
    const otherMember = keypair();
    await makePeer(other, 'Beta');
    await recordClaim(user, exportedFrom(other, otherMember, 'NovaThere'));
    expect((await mintIdentityRecords(ctx)).minted).toBe(1);

    const live = await liveIdentityRecords();
    expect(live).toHaveLength(1);
    expect(live[0]!.supersedes).toBe(first!.id);
    expect((live[0]!.body as Record<string, unknown>).alsoKnownAs).toEqual(
      [member.did, otherMember.did].sort(),
    );
  });

  it('retires the assertion when the member unlinks everything', async () => {
    // Silence is not a retraction to anybody who already holds the record.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));
    await mintIdentityRecords(ctx);

    await db
      .delete(schema.federatedIdentities)
      .where(eq(schema.federatedIdentities.localUserId, user));

    expect((await mintIdentityRecords(ctx)).withdrawn).toBe(1);
    expect(await liveIdentityRecords()).toHaveLength(0);
  });

  it('publishes nothing for a link only proven by a profile bio', async () => {
    // That was a conversation we had with a partner, not reproducible by
    // anybody else. Publishing it would ask every reader to take our word for
    // something we cannot show them.
    const user = await makeUser();
    await db.insert(schema.federatedIdentities).values({
      id: randomUUID(),
      localUserId: user,
      peerId,
      remoteUsername: 'Nova',
      status: 'verified',
      method: 'bio',
      verifiedAt: new Date(),
    });

    expect((await mintIdentityRecords(ctx)).minted).toBe(0);
  });
});

describe('taking in a partner\'s assertion', () => {
  const SUBJECT = 'did:key:z6MkTheirMember';

  it('keeps a link whose evidence proves the alias it claims', async () => {
    const doc = exportedFrom(partner, member);

    const kept = await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [member.did],
      'trackarr:evidence': [doc],
    });

    expect(kept).toBe(1);
    const [link] = await db.select().from(schema.remoteIdentityLinks);
    expect(link!.subjectDid).toBe(SUBJECT);
    expect(link!.aliasDid).toBe(member.did);
    expect(link!.evidence).toBeTruthy();
  });

  it('drops an alias with no evidence behind it', async () => {
    // Otherwise a partner could assert any two identifiers were one person and
    // every instance downstream would repeat it.
    const kept = await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [member.did, 'did:key:z6MkUnsupportedClaim'],
      'trackarr:evidence': [exportedFrom(partner, member)],
    });

    expect(kept).toBe(1);
    const links = await db.select().from(schema.remoteIdentityLinks);
    expect(links.map((l) => l.aliasDid)).toEqual([member.did]);
  });

  it('matches evidence to the alias it proves, not to its position', async () => {
    // A partner that shuffled one of the two lists would otherwise have every
    // alias attested by the wrong document.
    const a = keypair();
    const b = keypair();
    const kept = await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [a.did, b.did],
      'trackarr:evidence': [exportedFrom(partner, b), exportedFrom(partner, a)],
    });

    expect(kept).toBe(2);
    const links = await db.select().from(schema.remoteIdentityLinks);
    for (const l of links) {
      const ev = l.evidence as Record<string, unknown>;
      expect(ev.id).toBe(l.aliasDid);
    }
  });

  it('forgets a link the partner has stopped asserting', async () => {
    const a = keypair();
    const b = keypair();
    await ingestIdentityRecord(peerId, 'sha256:one', partner.did, {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [a.did, b.did],
      'trackarr:evidence': [exportedFrom(partner, a), exportedFrom(partner, b)],
    });
    expect(await db.select().from(schema.remoteIdentityLinks)).toHaveLength(2);

    await ingestIdentityRecord(peerId, 'sha256:two', partner.did, {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [a.did],
      'trackarr:evidence': [exportedFrom(partner, a)],
    });

    const links = await db.select().from(schema.remoteIdentityLinks);
    expect(links.map((l) => l.aliasDid)).toEqual([a.did]);
  });

  it('is idempotent', async () => {
    const doc = exportedFrom(partner, member);
    const body = {
      'trackarr:subject': SUBJECT,
      alsoKnownAs: [member.did],
      'trackarr:evidence': [doc],
    };
    await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, body);
    await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, body);

    expect(await db.select().from(schema.remoteIdentityLinks)).toHaveLength(1);
  });

  it('never throws on a malformed assertion', async () => {
    for (const body of [
      {},
      { 'trackarr:subject': 42 },
      { 'trackarr:subject': SUBJECT },
      { 'trackarr:subject': SUBJECT, alsoKnownAs: 'nope' },
      { 'trackarr:subject': SUBJECT, alsoKnownAs: [null, 7], 'trackarr:evidence': 'x' },
    ]) {
      await expect(
        ingestIdentityRecord(peerId, 'sha256:rec', partner.did, body as never),
      ).resolves.toBe(0);
    }
  });
});

describe('one person, across instances', () => {
  it('walks the link in both directions', async () => {
    // The assertion is one-directional; the relation is not. "Our member is
    // also X" and "we are where X came from" describe the same person.
    const them = 'did:key:z6MkTheirMember';
    await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, {
      'trackarr:subject': them,
      alsoKnownAs: [member.did],
      'trackarr:evidence': [exportedFrom(partner, member)],
    });

    expect(await aliasesOf(them)).toEqual(new Set([them, member.did]));
    expect(await aliasesOf(member.did)).toEqual(new Set([them, member.did]));
  });

  it('follows a chain across three instances', async () => {
    // A says its member is also X; B says its member X is also Y. All three
    // are one person, and neither A nor B had to know about the other.
    const beta = keypair();
    const betaPeer = await makePeer(beta, 'Beta');
    const x = keypair();
    const y = keypair();

    await ingestIdentityRecord(peerId, 'sha256:a', partner.did, {
      'trackarr:subject': 'did:key:z6MkAtAlpha',
      alsoKnownAs: [x.did],
      'trackarr:evidence': [exportedFrom(partner, x)],
    });
    await ingestIdentityRecord(betaPeer, 'sha256:b', beta.did, {
      'trackarr:subject': x.did,
      alsoKnownAs: [y.did],
      'trackarr:evidence': [exportedFrom(beta, y)],
    });

    const all = await aliasesOf('did:key:z6MkAtAlpha');
    expect(all).toEqual(new Set(['did:key:z6MkAtAlpha', x.did, y.did]));
  });

  it('terminates on a cycle of mutual assertions', async () => {
    // Two instances vouching for each other's members in a loop is trivial to
    // create, and a walk without a bound would follow it forever.
    const beta = keypair();
    const betaPeer = await makePeer(beta, 'Beta');
    const a = keypair();
    const b = keypair();

    await ingestIdentityRecord(peerId, 'sha256:a', partner.did, {
      'trackarr:subject': a.did,
      alsoKnownAs: [b.did],
      'trackarr:evidence': [exportedFrom(partner, b)],
    });
    await ingestIdentityRecord(betaPeer, 'sha256:b', beta.did, {
      'trackarr:subject': b.did,
      alsoKnownAs: [a.did],
      'trackarr:evidence': [exportedFrom(beta, a)],
    });

    expect(await aliasesOf(a.did)).toEqual(new Set([a.did, b.did]));
  });

  it('answers with the identifier itself when nobody has linked it', async () => {
    expect(await aliasesOf(member.did)).toEqual(new Set([member.did]));
  });
});

describe('the catalogue that survives its author', () => {
  it('gathers a member\'s work across the identifiers they answer to', async () => {
    // The point of all of it. Nova's uploads on the old instance are mirrored
    // here, attributed to the identifier she held there; she has proven that
    // identifier is hers; so they are her uploads, listed under the account
    // she has now — and they stay listed once the old instance is gone,
    // because the record lives in the mirror and says who wrote it.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));

    await db.insert(schema.remoteTorrents).values([
      {
        id: randomUUID(),
        peerId,
        remoteId: 'sha256:one',
        infoHash: 'a'.repeat(40),
        name: 'Her.Old.Upload.1080p',
        size: 1_000,
        authorDid: member.did,
        remoteCreatedAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: randomUUID(),
        peerId,
        remoteId: 'sha256:two',
        infoHash: 'b'.repeat(40),
        name: 'Somebody.Elses.Upload',
        size: 1_000,
        authorDid: 'did:key:z6MkSomebodyElse',
        remoteCreatedAt: new Date('2026-01-02T00:00:00Z'),
      },
    ]);

    const identities = await identitiesOfUser(user);
    expect(identities.has(member.did)).toBe(true);
    expect(identities.has(await ensureUserDid(user))).toBe(true);

    const mine = await db
      .select({ name: schema.remoteTorrents.name })
      .from(schema.remoteTorrents)
      .where(inArray(schema.remoteTorrents.authorDid, [...identities]));
    expect(mine.map((r) => r.name)).toEqual(['Her.Old.Upload.1080p']);
  });

  it('reaches a third instance the member never dealt with directly', async () => {
    // Nova proved Alpha to us. Beta separately asserts that the Alpha
    // identifier is also its own member's. Her work on Beta is hers too, and
    // nobody had to ask her twice.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));

    const beta = keypair();
    const betaPeer = await makePeer(beta, 'Beta');
    const atBeta = keypair();
    await ingestIdentityRecord(betaPeer, 'sha256:b', beta.did, {
      'trackarr:subject': atBeta.did,
      alsoKnownAs: [member.did],
      'trackarr:evidence': [exportedFrom(beta, member)],
    });

    expect(await identitiesOfUser(user)).toEqual(
      new Set([await ensureUserDid(user), member.did, atBeta.did]),
    );
  });

  it('claims nothing for a member with no proven links', async () => {
    const user = await makeUser();
    expect(await identitiesOfUser(user)).toEqual(
      new Set([await ensureUserDid(user)]),
    );
  });
});

describe('withdrawing an identifier', () => {
  it('publishes the withdrawal so it can travel', async () => {
    const user = await makeUser();
    const first = await ensureUserDid(user);
    const { previous, did } = await rotateUserKey(user);

    expect(previous).toBe(first);
    expect(did).not.toBe(first);
    expect((await mintRevocations(ctx)).minted).toBe(1);

    const [rec] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.kind, 'revocation'));
    const body = rec!.body as Record<string, unknown>;
    expect(body.type).toBe('Undo');
    expect(body.object).toBe(first);
    expect(body['trackarr:succeededBy']).toBe(did);
    expect(verifyRecord(body).ok).toBe(true);
  });

  it('publishes each withdrawal once', async () => {
    const user = await makeUser();
    await ensureUserDid(user);
    await rotateUserKey(user);
    await mintRevocations(ctx);

    expect((await mintRevocations(ctx)).minted).toBe(0);
  });

  it('drops the member\'s own proven links, so the old key proves nothing', async () => {
    // Rotating is what a member does when their file got out. Leaving their
    // links standing would mean it changed nothing for the one case it is for.
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));
    expect(
      await db
        .select()
        .from(schema.federatedIdentities)
        .where(eq(schema.federatedIdentities.localUserId, user)),
    ).toHaveLength(1);

    await rotateUserKey(user);

    expect(
      await db
        .select()
        .from(schema.federatedIdentities)
        .where(eq(schema.federatedIdentities.localUserId, user)),
    ).toHaveLength(0);
  });

  it('gives the member a working identity again immediately', async () => {
    const user = await makeUser();
    await ensureUserDid(user);
    const { did } = await rotateUserKey(user);

    expect(await ensureUserDid(user)).toBe(did);
    expect((await getUserPrivateKeyPem(user))!.did).toBe(did);
  });
});

describe('hearing that a partner withdrew one', () => {
  it('refuses the leaked file from then on', async () => {
    // The whole scenario, end to end. Nova's export gets out; somebody
    // presents it here and it works, because it is genuine. Her instance
    // withdraws the identifier; the same file stops working — and the
    // signatures on it are still perfectly valid, which is exactly why the
    // check has to exist rather than being implied by verification.
    const thief = await makeUser('Thief');
    const leaked = exportedFrom(partner, member);
    expect((await recordClaim(thief, leaked)).ok).toBe(true);

    await ingestRevocation(peerId, 'sha256:undo', partner.did, {
      type: 'Undo',
      object: member.did,
      'trackarr:succeededBy': 'did:key:z6MkHerNewOne',
    });

    // The link that was already made is gone...
    expect(
      await db
        .select()
        .from(schema.federatedIdentities)
        .where(eq(schema.federatedIdentities.localUserId, thief)),
    ).toHaveLength(0);
    // ...and presenting the same file again is refused.
    const again = await recordClaim(thief, leaked);
    expect(again.ok).toBe(false);
    expect(again.reason).toMatch(/withdrawn/i);
  });

  it('blocks a file whose withdrawal arrived before anybody used it', async () => {
    // The case worth being ready for: a leaked file is used by whoever finds
    // it, whenever they find it, which may be long after.
    await ingestRevocation(peerId, 'sha256:undo', partner.did, {
      type: 'Undo',
      object: member.did,
    });

    const user = await makeUser();
    expect((await recordClaim(user, exportedFrom(partner, member))).ok).toBe(false);
  });

  it('drops the assertions other instances made with it', async () => {
    const them = 'did:key:z6MkTheirMember';
    await ingestIdentityRecord(peerId, 'sha256:rec', partner.did, {
      'trackarr:subject': them,
      alsoKnownAs: [member.did],
      'trackarr:evidence': [exportedFrom(partner, member)],
    });
    expect(await db.select().from(schema.remoteIdentityLinks)).toHaveLength(1);

    await ingestRevocation(peerId, 'sha256:undo', partner.did, {
      type: 'Undo',
      object: member.did,
    });

    expect(await db.select().from(schema.remoteIdentityLinks)).toHaveLength(0);
    expect(await aliasesOf(them)).toEqual(new Set([them]));
  });

  it('lets nobody withdraw an identifier that is not theirs', async () => {
    // Otherwise any partner could unpick any link in the federation by
    // announcing withdrawals for keys it never issued.
    const beta = keypair();
    const betaPeer = await makePeer(beta, 'Beta');
    const user = await makeUser();
    await recordClaim(user, exportedFrom(partner, member));

    await ingestRevocation(betaPeer, 'sha256:undo', beta.did, {
      type: 'Undo',
      object: member.did,
    });

    // Beta's word about Alpha's member changes nothing here.
    expect(
      await db
        .select()
        .from(schema.federatedIdentities)
        .where(eq(schema.federatedIdentities.localUserId, user)),
    ).toHaveLength(1);
    expect((await recordClaim(user, exportedFrom(partner, member))).ok).toBe(true);
  });

  it('never throws on a malformed withdrawal', async () => {
    for (const body of [
      {},
      { type: 'Undo' },
      { type: 'Undo', object: 42 },
      { type: 'Undo', object: 'https://not-a-did' },
    ]) {
      await expect(
        ingestRevocation(peerId, 'sha256:undo', partner.did, body as never),
      ).resolves.toBe(false);
    }
  });
});
