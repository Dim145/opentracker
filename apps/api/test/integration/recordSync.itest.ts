import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { CONTEXT, signRecord } from '../../utils/federation/record';

// Ingesting signed records.
//
// This is where the architecture actually changes, so the tests are about one
// question: **is a record accepted because of its proof, or because of who
// sent it?** Everything below is a way of asking that.
//
// The old path trusted the connection, which is why a record could never be
// relayed — B saying "C published this" was unverifiable. If any of these
// tests can be made to pass by trusting the peer instead of the proof, the
// property is gone and with it every reason to have built this.
//
// The second theme is the one that gets signed-data systems compromised: a
// valid signature proves the issuer wrote these bytes and says NOTHING about
// whether the issuer is honest. A signed `size: -1` is a perfectly valid
// record.

const partner = vi.hoisted(() => ({
  pages: [] as Array<{ records: unknown[]; nextCursor: number }>,
  calls: [] as Array<{ since: string | null }>,
  status: 200,
}));

vi.mock('../../utils/federation/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/federation/signing')>()),
  signedGet: async ({ pathname }: { pathname: string }) => {
    const [, qs = ''] = pathname.split('?');
    const params = new URLSearchParams(qs);
    partner.calls.push({ since: params.get('since') });
    if (partner.status !== 200) return { status: partner.status, data: null };
    const page = partner.pages.shift() ?? { records: [], nextCursor: 0 };
    return { status: 200, data: { ok: true, ...page } };
  },
}));

const { syncPeerRecords } = await import('../../utils/federation/recordSync');
const { ensureFederationIdentity } = await import('../../utils/federation/config');

let issuer: { privateKeyPem: string; did: string };
let counter = 0;

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ),
  };
}

function record(over: Record<string, unknown> = {}) {
  const draft = {
    '@context': CONTEXT,
    type: 'Torrent',
    'bt:infohash_v1': (counter++).toString(16).padStart(40, 'e'),
    'bt:magnet': null,
    url: 'https://origin.example/torrents/abc',
    name: 'Show.S02E03.1080p.WEB-DL-NTb',
    content: null,
    published: '2026-05-01T00:00:00.000Z',
    attributedTo: null,
    'trackarr:size': 2_540_000_000,
    'trackarr:contentSignature': null,
    'trackarr:category': 'tv-hd',
    'trackarr:categoryType': 'tv',
    'trackarr:isAdult': false,
    'trackarr:tags': ['1080p'],
    'trackarr:imdbId': null,
    'trackarr:tmdbId': 'tv/1',
    'trackarr:tvdbId': null,
    'trackarr:igdbId': null,
    'trackarr:openlibraryId': null,
    'trackarr:season': 2,
    'trackarr:episode': 3,
    'trackarr:uploaderName': 'RemoteUp',
    'trackarr:issuer': issuer.did,
    'trackarr:replaces': null,
    ...over,
  };
  return signRecord(draft as never, {
    privateKeyPem: issuer.privateKeyPem,
    did: issuer.did,
  });
}

function tombstone(replaces: string, infoHash: string) {
  return signRecord(
    {
      '@context': CONTEXT,
      type: 'Tombstone',
      'bt:infohash_v1': infoHash,
      published: '2026-05-02T00:00:00.000Z',
      'trackarr:issuer': issuer.did,
      'trackarr:replaces': replaces,
    } as never,
    { privateKeyPem: issuer.privateKeyPem, did: issuer.did },
  );
}

async function makePeer(): Promise<FederationPeer> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.federationPeers)
    .values({
      id,
      baseUrl: `https://p-${id.slice(0, 8)}.example`,
      displayName: 'Partner',
      instanceId: `tk_${id.slice(0, 10)}`,
      status: 'active',
      sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
      acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
    })
    .returning();
  return row!;
}

async function mirrored(peerId: string) {
  return db
    .select()
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peerId));
}

beforeEach(async () => {
  partner.pages = [];
  partner.calls = [];
  partner.status = 200;
  counter = 0;
  issuer = keypair();
  // The identity is provisioned but federation ships DISABLED, and
  // `syncPeerRecords` refuses to run without it — as it should.
  await ensureFederationIdentity();
  await db
    .update(schema.federationConfig)
    .set({ enabled: true })
    .where(eq(schema.federationConfig.id, 'singleton'));
});

describe('accepting a record', () => {
  it('mirrors one that verifies, and marks it verified', async () => {
    const peer = await makePeer();
    const r = record();
    partner.pages = [{ records: [r], nextCursor: 7 }];

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(1);
    expect(out.rejected).toBe(0);

    const [row] = await mirrored(peer.id);
    expect(row!.verified).toBe(true);
    expect(row!.recordId).toBe(r.id);
    // The signer, not the sender. They are the same here and will not be once
    // records are relayed — storing the sender would quietly make the
    // distinction unrecoverable.
    expect(row!.issuer).toBe(issuer.did);
    expect(row!.season).toBe(2);
    expect(row!.episode).toBe(3);
  });

  it('refuses one that was edited in flight', async () => {
    // The property the whole design rests on. If a peer can change a record
    // and have it accepted, nothing above this line is worth anything.
    const peer = await makePeer();
    const tampered = JSON.parse(JSON.stringify(record()));
    tampered.name = 'Something.Else-A';
    partner.pages = [{ records: [tampered], nextCursor: 1 }];

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(0);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('refuses one with no proof at all', async () => {
    const peer = await makePeer();
    const bare = JSON.parse(JSON.stringify(record()));
    delete bare.proof;
    partner.pages = [{ records: [bare], nextCursor: 1 }];

    expect((await syncPeerRecords(peer)).rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('keeps the good records of a page that also carries bad ones', async () => {
    // A partner sending one forged record must not cost us the rest of the
    // page — otherwise a single bad row is a denial of service on the sync.
    const peer = await makePeer();
    const bad = JSON.parse(JSON.stringify(record()));
    bad['trackarr:size'] = 1;
    partner.pages = [{ records: [record(), bad, record()], nextCursor: 3 }];

    const out = await syncPeerRecords(peer);
    expect(out.ingested).toBe(2);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(2);
  });

  it('leaves the failures where an operator can see them', async () => {
    const peer = await makePeer();
    const bad = JSON.parse(JSON.stringify(record()));
    bad.name = 'edited';
    partner.pages = [{ records: [bad], nextCursor: 1 }];
    await syncPeerRecords(peer);

    const [state] = await db
      .select()
      .from(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peer.id));
    expect(state!.lastStatus).toBe('partial');
    expect(state!.lastError).toContain('verification');
  });
});

describe('a proof is not a validation', () => {
  it('coerces a signed but implausible value instead of storing it', async () => {
    // A valid signature proves the issuer wrote these bytes. It says nothing
    // about whether the issuer is honest, and conflating the two is how
    // signed-data systems get compromised.
    const peer = await makePeer();
    partner.pages = [
      {
        records: [
          record({
            'trackarr:size': -5,
            'trackarr:season': 99_999,
            'trackarr:episode': 1.5,
            url: 'javascript:alert(1)',
          }),
        ],
        nextCursor: 1,
      },
    ];

    await syncPeerRecords(peer);
    const [row] = await mirrored(peer.id);
    expect(row!.size).toBe(0);
    expect(row!.season).toBeNull();
    expect(row!.episode).toBeNull();
    // Never a `javascript:` URL into a template's href, signed or not.
    expect(row!.remoteDetailUrl?.startsWith('https://')).toBe(true);
  });

  it('takes the release location from the record, not from the relay', async () => {
    // A record says where its content lives. The peer that handed it over is
    // not necessarily that place, and will not be once records are relayed.
    const peer = await makePeer();
    partner.pages = [
      { records: [record({ url: 'https://origin.example/torrents/xyz' })], nextCursor: 1 },
    ];

    await syncPeerRecords(peer);
    const [row] = await mirrored(peer.id);
    expect(row!.remoteDetailUrl).toBe('https://origin.example/torrents/xyz');
  });
});

describe('the lifecycle a record carries', () => {
  it('replaces the generation it supersedes', async () => {
    const peer = await makePeer();
    const first = record({ name: 'First.Name-A' });
    partner.pages = [{ records: [first], nextCursor: 1 }];
    await syncPeerRecords(peer);

    const second = record({
      name: 'Second.Name-A',
      'bt:infohash_v1': (first as unknown as Record<string, string>)['bt:infohash_v1'],
      'trackarr:replaces': first.id,
    });
    partner.pages = [{ records: [second], nextCursor: 2 }];
    await syncPeerRecords(peer);

    const rows = await mirrored(peer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Second.Name-A');
    expect(rows[0]!.recordId).toBe(second.id);
  });

  it('applies a withdrawal as a statement', async () => {
    const peer = await makePeer();
    const r = record();
    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(peer);
    expect(await mirrored(peer.id)).toHaveLength(1);

    const hash = (r as unknown as Record<string, string>)['bt:infohash_v1']!;
    partner.pages = [{ records: [tombstone(r.id, hash)], nextCursor: 2 }];
    const out = await syncPeerRecords(peer);

    expect(out.withdrawn).toBeGreaterThan(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('refuses a forged withdrawal', async () => {
    // Otherwise anyone able to reach us could empty the mirror.
    const peer = await makePeer();
    const r = record();
    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(peer);

    const hash = (r as unknown as Record<string, string>)['bt:infohash_v1']!;
    const forged = JSON.parse(JSON.stringify(tombstone(r.id, hash)));
    forged['trackarr:issuer'] = 'did:key:zSomebodyElse';
    partner.pages = [{ records: [forged], nextCursor: 2 }];

    const out = await syncPeerRecords(peer);
    expect(out.rejected).toBe(1);
    expect(await mirrored(peer.id)).toHaveLength(1);
  });
});

describe('the sync loop', () => {
  it('is idempotent — the same record twice is one row', async () => {
    const peer = await makePeer();
    const r = record();
    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(peer);
    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(peer);

    expect(await mirrored(peer.id)).toHaveLength(1);
  });

  it('remembers where it stopped', async () => {
    const peer = await makePeer();
    partner.pages = [{ records: [record()], nextCursor: 42 }];
    await syncPeerRecords(peer);

    partner.pages = [{ records: [], nextCursor: 42 }];
    await syncPeerRecords(peer);
    expect(partner.calls.at(-1)!.since).toBe('42');
  });

  it('stops rather than looping when the cursor does not move', async () => {
    // A partner that keeps answering with the same page and the same cursor
    // would otherwise spin until the page budget ran out, every cycle.
    const peer = await makePeer();
    for (let i = 0; i < 5; i++) {
      partner.pages.push({ records: [record()], nextCursor: 0 });
    }
    await syncPeerRecords(peer);
    expect(partner.calls).toHaveLength(1);
  });

  it('records a transport failure without throwing', async () => {
    const peer = await makePeer();
    partner.status = 503;

    const out = await syncPeerRecords(peer);
    expect(out.error).toContain('503');

    const [state] = await db
      .select()
      .from(schema.federationSyncState)
      .where(eq(schema.federationSyncState.peerId, peer.id));
    expect(state!.lastStatus).toBe('error');
  });

  it('keeps two partners\' copies of one record apart', async () => {
    // They are two places to fetch the same statement, not one row. Collapsing
    // them would erase a source along with its address.
    const a = await makePeer();
    const b = await makePeer();
    const r = record();

    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(a);
    partner.pages = [{ records: [r], nextCursor: 1 }];
    await syncPeerRecords(b);

    expect(await mirrored(a.id)).toHaveLength(1);
    expect(await mirrored(b.id)).toHaveLength(1);
  });
});
