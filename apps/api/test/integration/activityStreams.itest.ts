import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  actorDocument,
  contextDocument,
  outboxPage,
  outboxSize,
} from '../../utils/federation/activityStreams';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord, verifyRecord } from '../../utils/federation/record';
import { keepForRelay } from '../../utils/federation/relay';
import { ensureFederationIdentity } from '../../utils/federation/config';

// The part of this a stranger can read.
//
// Everything else in federation is a signed conversation between instances that
// agreed to know each other. This is the door for somebody who has not — so the
// questions are: does it say enough to be useful, does it say anything it
// should not, and does what goes out still verify once it has been through a
// collection rather than a signed exchange.

let counter = 0;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  return {
    publicKeyPem,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(publicKeyPem),
  };
}

function record(issuer: ReturnType<typeof keypair>, adult = false) {
  return signRecord(
    {
      '@context': CONTEXT,
      type: 'Torrent',
      'bt:infohash_v1': (counter++).toString(16).padStart(40, 'c'),
      'bt:magnet': null,
      url: 'https://origin.example/torrents/abc',
      name: `Release.${counter}`,
      content: null,
      published: '2026-05-01T00:00:00.000Z',
      attributedTo: null,
      'trackarr:size': 10,
      'trackarr:contentSignature': null,
      'trackarr:category': null,
      'trackarr:categoryType': null,
      'trackarr:isAdult': adult,
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

/** A record this instance published, as the minter would have left it. */
async function publish(issuer: ReturnType<typeof keypair>, adult = false) {
  const r = record(issuer, adult);
  await db.insert(schema.catalogRecords).values({
    id: r.id,
    torrentId: randomUUID(),
    infoHash: r['bt:infohash_v1'],
    issuer: issuer.did,
    kind: 'torrent',
    body: r as unknown as Record<string, unknown>,
    contentHash: r.id,
    origin: 'local',
  });
  return r;
}

let config: Awaited<ReturnType<typeof ensureFederationIdentity>>;

beforeEach(async () => {
  counter = 0;
  config = await ensureFederationIdentity();
  await db
    .update(schema.federationConfig)
    .set({ publicUrl: 'https://alpha.example', instanceName: 'Alpha' })
    .where(eq(schema.federationConfig.id, 'singleton'));
  config = (await db.select().from(schema.federationConfig).limit(1))[0]!;
});

describe('the actor', () => {
  it('names the instance and the key its records are signed with', () => {
    const actor = actorDocument(config);

    expect(actor.type).toBe('Service');
    expect(actor.id).toBe('https://alpha.example/api/federation/actor');
    expect(actor.name).toBe('Alpha');
    expect(actor.outbox).toBe('https://alpha.example/api/federation/outbox');

    const did = didKeyFromPublicKey(config.publicKey!);
    const [method] = actor.assertionMethod as Array<Record<string, unknown>>;
    expect(method!.id).toBe(`${did}#${did.slice('did:key:'.length)}`);
    expect(method!.type).toBe('Multikey');
  });

  it('publishes the key in both shapes a reader might expect', () => {
    // `assertionMethod` for a Data Integrity verifier, `publicKey` for the
    // older fediverse convention most software still reads. Cheap, and the
    // difference between being verifiable and being verifiable in practice.
    const actor = actorDocument(config);
    expect((actor.publicKey as Record<string, unknown>).publicKeyPem).toBe(
      config.publicKey,
    );
  });

  it('advertises no inbox', () => {
    // Nothing here accepts activities. Advertising an inbox we do not serve
    // would invite deliveries we would only drop — and would be a second way
    // in to defend, when federation already has one.
    expect(actorDocument(config).inbox).toBeUndefined();
  });

  it('says nothing at all when the instance has no key yet', () => {
    const bare = { ...config, publicKey: null };
    const actor = actorDocument(bare as typeof config);
    expect(actor.assertionMethod).toBeUndefined();
    expect(actor.publicKey).toBeUndefined();
    expect(actor.type).toBe('Service');
  });
});

describe('the outbox', () => {
  it('lists what this instance published, newest first', async () => {
    const me = keypair();
    const first = await publish(me);
    const second = await publish(me);
    await db
      .update(schema.catalogRecords)
      .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
      .where(eq(schema.catalogRecords.id, first.id));

    expect(await outboxSize()).toBe(2);
    const page = await outboxPage(1);
    expect(page.map((r) => r.id)).toEqual([second.id, first.id]);
  });

  it('hands records over exactly as signed', async () => {
    // The whole value of the surface. A record rebuilt for presentation is a
    // record whose proof no longer holds, and a consumer that could not verify
    // what it fetched would be back to trusting whoever served it.
    const me = keypair();
    await publish(me);

    const [served] = await outboxPage(1);
    expect(verifyRecord(served).ok).toBe(true);
  });

  it('carries the interoperable core a stranger can act on', async () => {
    // What FEP-d8c8 defines and what a consumer knowing nothing about Trackarr
    // still understands: which release this is, and where to get it.
    const me = keypair();
    const r = await publish(me);

    const [served] = await outboxPage(1);
    expect(served!['bt:infohash_v1']).toBe(r['bt:infohash_v1']);
    expect(served!.type).toBe('Torrent');
    expect(served!.url).toBeTruthy();
    expect(served!['@context']).toContain('https://w3id.org/fep/d8c8.jsonld');
  });

  it('never lists a record we merely carry for somebody else', async () => {
    // A relayed record belongs in its author's outbox. Listing it here would
    // be this instance claiming somebody else's work.
    const me = keypair();
    const mine = await publish(me);
    const stranger = keypair();
    await keepForRelay(
      record(stranger) as unknown as Record<string, unknown>,
      stranger.did,
      1,
    );

    expect(await outboxSize()).toBe(1);
    expect((await outboxPage(1)).map((r) => r.id)).toEqual([mine.id]);
  });

  it('never lists a generation that has been replaced', async () => {
    const me = keypair();
    const r = await publish(me);
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date() })
      .where(eq(schema.catalogRecords.id, r.id));

    expect(await outboxSize()).toBe(0);
    expect(await outboxPage(1)).toEqual([]);
  });

  it('keeps adult-flagged releases off the public collection', async () => {
    // The distinction the first version of this endpoint missed. Federating
    // with chosen partners and being readable by anyone are two decisions, and
    // an operator making the second one has not thereby made a third about
    // what a stranger, logged in nowhere, sees by default.
    //
    // The flag itself still travels on every record that does go out, so a
    // consumer keeps its own say.
    const me = keypair();
    const ordinary = await publish(me);
    await publish(me, true);

    expect(await outboxSize()).toBe(1);
    expect((await outboxPage(1)).map((r) => r.id)).toEqual([ordinary.id]);
  });

  it('counts and lists the same set, or paging walks off the end', async () => {
    // A filter applied to the page but not to the count is the classic way to
    // break a collection: the header promises more than the pages hold, and a
    // consumer walks past the end looking for the difference.
    const me = keypair();
    await publish(me);
    await publish(me, true);
    await publish(me);

    const total = await outboxSize();
    const listed = (await outboxPage(1)).length;
    expect(listed).toBe(total);
  });

  it('pages without repeating or skipping', async () => {
    const me = keypair();
    for (let i = 0; i < 5; i++) await publish(me);

    const all = await outboxPage(1);
    expect(all).toHaveLength(5);
    expect(new Set(all.map((r) => r.id)).size).toBe(5);
    expect(await outboxPage(2)).toEqual([]);
  });
});

describe('the vocabulary', () => {
  it('maps every term the records actually use', () => {
    // A vocabulary that documents fields nobody emits, or misses ones
    // everybody does, is worse than none: it reads as authoritative.
    const ctx = contextDocument(config)['@context'] as Record<string, unknown>;
    for (const term of [
      'size',
      'contentSignature',
      'category',
      'categoryType',
      'isAdult',
      'tags',
      'imdbId',
      'tmdbId',
      'tvdbId',
      'igdbId',
      'openlibraryId',
      'season',
      'episode',
      'uploaderName',
      'issuer',
      'replaces',
    ]) {
      expect(ctx[term], term).toBeTruthy();
    }
  });

  it('resolves to this instance, so the terms can be looked up', () => {
    const ctx = contextDocument(config)['@context'] as Record<string, string>;
    expect(ctx.trackarr).toBe(
      'https://alpha.example/api/federation/context#',
    );
  });
});
