import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord, verifyRecord } from '../../utils/federation/record';
import {
  admit,
  countersign,
  countersigner,
  keepForRelay,
  trustedIssuers,
} from '../../utils/federation/relay';
import { publishedSet } from '../../utils/federation/recordSet';
import { MIN_BOUND } from '../../utils/federation/rbsr';
import { ensureFederationIdentity } from '../../utils/federation/config';

// Carrying somebody else's records.
//
// The property that makes relaying safe is that a relay has no power worth
// abusing: every record proves itself, so a relay can omit or delay and never
// forge or alter. What it CAN do is introduce — and that is the part with
// teeth, because an instance that took in every record that verified would be
// an open index rather than a curated catalogue.
//
// So the tests are about the introduction. Who may make one, what it is worth,
// and how far a record is allowed to travel on the strength of it.

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

let counter = 0;

/** A record signed by whoever is given as its issuer. */
function record(issuer: ReturnType<typeof keypair>) {
  return signRecord(
    {
      '@context': CONTEXT,
      type: 'Torrent',
      'bt:infohash_v1': (counter++).toString(16).padStart(40, 'e'),
      'bt:magnet': null,
      url: 'https://origin.example/torrents/abc',
      name: `Release.${counter}.1080p`,
      content: null,
      published: '2026-05-01T00:00:00.000Z',
      attributedTo: null,
      'trackarr:size': 1000,
      'trackarr:contentSignature': null,
      'trackarr:category': null,
      'trackarr:categoryType': null,
      'trackarr:isAdult': false,
      'trackarr:tags': [],
      'trackarr:imdbId': null,
      'trackarr:tmdbId': null,
      'trackarr:tvdbId': null,
      'trackarr:igdbId': null,
      'trackarr:openlibraryId': null,
      'trackarr:season': null,
      'trackarr:episode': null,
      'trackarr:uploaderName': 'Somebody',
      'trackarr:issuer': issuer.did,
      'trackarr:replaces': null,
    } as never,
    { privateKeyPem: issuer.privateKeyPem, did: issuer.did },
  );
}

async function makePeer(keys: { publicKeyPem: string }, name = 'Partner') {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: keys.publicKeyPem,
    displayName: name,
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
  });
  return id;
}

beforeEach(async () => {
  counter = 0;
  await ensureFederationIdentity();
});

describe('who we will take a record from', () => {
  it('takes one from a partner, first hand', async () => {
    const partner = keypair();
    await makePeer(partner);

    const r = record(partner);
    const pass = admit(partner.did, r.id, null, await trustedIssuers());

    expect(pass.ok).toBe(true);
    expect(pass.hops).toBe(1);
  });

  it('refuses a stranger, however good the signature', async () => {
    // The one that matters. A valid proof from somebody we do not federate
    // with is a valid proof from somebody we do not federate with, and an
    // instance that could not tell the difference would be an open index.
    const stranger = keypair();
    const r = record(stranger);

    const pass = admit(stranger.did, r.id, null, await trustedIssuers());

    expect(pass.ok).toBe(false);
    expect(pass.reason).toMatch(/not a partner/i);
  });

  it('takes a stranger\'s record when a partner puts its name to it', async () => {
    const partner = keypair();
    const origin = keypair();
    await makePeer(partner);

    const r = record(origin);
    const vouch = countersign(r.id, partner.did, partner.privateKeyPem);
    const pass = admit(origin.did, r.id, vouch, await trustedIssuers());

    expect(pass.ok).toBe(true);
    expect(pass.hops).toBe(2);
    expect(pass.via).toBe(partner.did);
  });

  it('refuses a vouching from somebody we do not federate with either', async () => {
    const stranger = keypair();
    const origin = keypair();

    const r = record(origin);
    const vouch = countersign(r.id, stranger.did, stranger.privateKeyPem);

    expect(admit(origin.did, r.id, vouch, await trustedIssuers()).ok).toBe(false);
  });

  it('gains nothing from a stranger vouching for themselves', async () => {
    // The obvious way round the rule: sign the record, sign an introduction
    // for it, be your own referee. It fails for the same reason the bare
    // record does — the voucher has to be a partner, and this one is not.
    // Worth pinning, because it is the shape somebody will try.
    const stranger = keypair();
    const r = record(stranger);
    const vouch = countersign(r.id, stranger.did, stranger.privateKeyPem);

    const pass = admit(stranger.did, r.id, vouch, await trustedIssuers());
    expect(pass.ok).toBe(false);
  });

  it('refuses a vouching lifted from another record', async () => {
    // The countersignature is checked against the id WE computed, so one made
    // for a different record does not travel with a substituted body.
    const partner = keypair();
    await makePeer(partner);
    const origin = keypair();

    const a = record(origin);
    const b = record(origin);
    const vouchForA = countersign(a.id, partner.did, partner.privateKeyPem);

    expect(countersigner(b.id, vouchForA)).toBeNull();
    expect(admit(origin.did, b.id, vouchForA, await trustedIssuers()).ok).toBe(false);
  });

  it('stops trusting a partner the moment it is suspended', async () => {
    const partner = keypair();
    const peerId = await makePeer(partner);
    expect((await trustedIssuers()).has(partner.did)).toBe(true);

    await db
      .update(schema.federationPeers)
      .set({ status: 'suspended' })
      .where(eq(schema.federationPeers.id, peerId));

    expect((await trustedIssuers()).has(partner.did)).toBe(false);
  });

  it('never throws on a malformed vouching', async () => {
    const origin = keypair();
    const r = record(origin);
    for (const bad of [null, undefined, 42, 'proof', {}, { verificationMethod: 7 }]) {
      expect(countersigner(r.id, bad)).toBeNull();
      expect(admit(origin.did, r.id, bad, new Set()).ok).toBe(false);
    }
  });
});

describe('what we will hand on', () => {
  async function served(relaying: boolean): Promise<string[]> {
    return publishedSet(relaying).ids(MIN_BOUND, null, 100);
  }

  it('keeps a record we took in, as the bytes that were signed', async () => {
    // Reconstructing one from the mirror row would be a second implementation
    // of the format, and it would eventually disagree with the proof.
    const origin = keypair();
    const r = record(origin);

    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    const [stored] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, r.id));
    expect(stored!.origin).toBe('ingested');
    expect(stored!.hops).toBe(1);
    expect(stored!.issuer).toBe(origin.did);
    // Not a string comparison: `jsonb` does not keep key order, and it does
    // not need to — canonicalisation sorts before hashing, which is the whole
    // reason a record can survive a database round trip at all. What has to
    // hold is that it still verifies.
    expect(verifyRecord(stored!.body).ok).toBe(true);
    expect((stored!.body as Record<string, unknown>).id).toBe(r.id);
  });

  it('offers nothing of anybody else\'s while relaying is off', async () => {
    const origin = keypair();
    await keepForRelay(record(origin) as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(false)).toHaveLength(0);
  });

  it('offers what it took first-hand once relaying is on', async () => {
    const origin = keypair();
    const r = record(origin);
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(true)).toEqual([r.id]);
  });

  it('never hands on what was already relayed to it', async () => {
    // Where the two-hop bound is actually enforced. A record that reached us
    // through somebody else stops here — otherwise the introduction chain has
    // no end, and "two hops" is a sentence in a document rather than a rule.
    const origin = keypair();
    const first = record(origin);
    const second = record(origin);
    await keepForRelay(first as unknown as Record<string, unknown>, origin.did, 1);
    await keepForRelay(second as unknown as Record<string, unknown>, origin.did, 2);

    expect(await served(true)).toEqual([first.id]);
  });

  it('stops offering a generation its issuer has replaced', async () => {
    const origin = keypair();
    const first = record(origin);
    await keepForRelay(first as unknown as Record<string, unknown>, origin.did, 1);

    const successor = signRecord(
      {
        ...(JSON.parse(JSON.stringify(first)) as Record<string, unknown>),
        proof: undefined,
        id: undefined,
        name: 'Renamed.1080p',
        'trackarr:replaces': first.id,
      } as never,
      { privateKeyPem: origin.privateKeyPem, did: origin.did },
    );
    await keepForRelay(successor as unknown as Record<string, unknown>, origin.did, 1);

    expect(await served(true)).toEqual([successor.id]);
    const [old] = await db
      .select()
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, first.id));
    expect(old!.supersededAt).toBeTruthy();
  });

  it('is idempotent — the same record twice is one row', async () => {
    const origin = keypair();
    const r = record(origin);
    const body = r as unknown as Record<string, unknown>;
    await keepForRelay(body, origin.did, 1);
    await keepForRelay(body, origin.did, 1);

    expect(await db.select().from(schema.catalogRecords)).toHaveLength(1);
  });
});

describe('the store stays ours to sweep', () => {
  it('never lets a withdrawal sweep reach somebody else\'s records', async () => {
    // The sharpest edge in this step. An ingested record has no local torrent
    // behind it — which, from inside the tombstone sweep, is exactly what a
    // deleted release looks like. Without the origin filter this instance
    // would publish tombstones for every partner's catalogue.
    const origin = keypair();
    const r = record(origin);
    await keepForRelay(r as unknown as Record<string, unknown>, origin.did, 1);

    const sweepable = await db
      .select({ id: schema.catalogRecords.id })
      .from(schema.catalogRecords)
      .leftJoin(
        schema.torrents,
        eq(schema.torrents.id, schema.catalogRecords.torrentId),
      )
      .where(
        and(
          isNull(schema.catalogRecords.supersededAt),
          eq(schema.catalogRecords.kind, 'torrent'),
          eq(schema.catalogRecords.origin, 'local'),
          isNull(schema.torrents.id),
        ),
      );

    expect(sweepable).toHaveLength(0);
  });
});
