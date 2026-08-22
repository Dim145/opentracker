import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { recordStore, sourcedByPeer } from '../../utils/federation/storeCounts';

// The numbers an operator reads.
//
// Run against a real database because the interesting failure is a SQL one: an
// aggregate with `FILTER` clauses and a two-column grouping either throws where
// nobody is looking, or quietly reports a wrong figure for months. A page an
// operator trusts is worth more than a page that renders.

let n = 0;

async function record(over: Partial<typeof schema.catalogRecords.$inferInsert> = {}) {
  const id = `sha256:${(n++).toString(16).padStart(8, '0')}`;
  await db.insert(schema.catalogRecords).values({
    id,
    torrentId: randomUUID(),
    infoHash: (n).toString(16).padStart(40, 'a'),
    issuer: 'did:key:zSomebody',
    kind: 'torrent',
    body: { id },
    contentHash: id,
    origin: 'local',
    ...over,
  });
  return id;
}

async function peer(): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.federationPeers).values({
    id,
    baseUrl: `https://p-${id.slice(0, 8)}.example`,
    instanceId: `tk_${id.slice(0, 12)}`,
    publicKey: 'pk',
    status: 'active',
    sharesWithThem: { catalog: true, social: false, accounts: false, swarm: false },
    acceptsFromThem: { catalog: true, social: false, accounts: false, swarm: false },
  });
  return id;
}

describe('what the store holds', () => {
  it('counts nothing as nothing, rather than throwing', async () => {
    // An operator's first look at a fresh instance. `string_agg` over an empty
    // group and a `FILTER` that matches nothing are exactly where an aggregate
    // returns NULL and a page 500s.
    const store = await recordStore();
    expect(store).toEqual({
      local: 0,
      ingested: 0,
      relayable: 0,
      superseded: 0,
      byKind: {},
    });
  });

  it('separates what we said from what we took in', async () => {
    await record();
    await record();
    await record({ origin: 'ingested', hops: 1 });

    const store = await recordStore();
    expect(store.local).toBe(2);
    expect(store.ingested).toBe(1);
  });

  it('counts as relayable only what came to us first hand', async () => {
    // The two-hop bound, seen from the operator's side. A number that counted
    // second-hand records as relayable would describe an instance doing
    // something it refuses to do.
    await record({ origin: 'ingested', hops: 1 });
    await record({ origin: 'ingested', hops: 2 });

    const store = await recordStore();
    expect(store.ingested).toBe(2);
    expect(store.relayable).toBe(1);
  });

  it('never counts ours as relayable, whatever its hop count says', async () => {
    await record({ hops: 0 });
    expect((await recordStore()).relayable).toBe(0);
  });

  it('holds replaced generations apart from current ones', async () => {
    await record();
    await record({ supersededAt: new Date() });

    const store = await recordStore();
    expect(store.local).toBe(1);
    expect(store.superseded).toBe(1);
    // And not folded into the kind, or one edited release reads as two.
    expect(store.byKind.torrent).toBe(1);
  });

  it('breaks down by kind, so a backlog is visible as itself', async () => {
    // The reason this is here at all: tombstones and identity records have no
    // mirror row, so before this they were invisible in every view.
    await record();
    await record({ kind: 'tombstone' });
    await record({ kind: 'tombstone' });
    await record({ kind: 'identity', origin: 'ingested', hops: 1 });

    const store = await recordStore();
    expect(store.byKind).toEqual({ torrent: 1, tombstone: 2, identity: 1 });
  });
});

describe('what we hold for each partner', () => {
  it('counts per partner and leaves the others alone', async () => {
    const a = await peer();
    const b = await peer();
    await db.insert(schema.recordSources).values([
      { recordId: 'sha256:1', peerId: a, kind: 'torrent' },
      { recordId: 'sha256:2', peerId: a, kind: 'tombstone' },
      { recordId: 'sha256:1', peerId: b, kind: 'torrent' },
    ]);

    const counts = await sourcedByPeer([a, b]);
    expect(counts.get(a)).toBe(2);
    expect(counts.get(b)).toBe(1);
  });

  it('counts every kind, which is the whole point', async () => {
    // Counting only torrents here would reproduce, in the health view, the
    // exact defect the health view exists to make visible.
    const a = await peer();
    await db.insert(schema.recordSources).values([
      { recordId: 'sha256:t', peerId: a, kind: 'torrent' },
      { recordId: 'sha256:d', peerId: a, kind: 'tombstone' },
      { recordId: 'sha256:i', peerId: a, kind: 'identity' },
      { recordId: 'sha256:r', peerId: a, kind: 'revocation' },
    ]);

    expect((await sourcedByPeer([a])).get(a)).toBe(4);
  });

  it('says nothing about a partner we hold nothing from', async () => {
    const a = await peer();
    expect((await sourcedByPeer([a])).get(a)).toBeUndefined();
  });

  it('asks the database nothing when there are no partners', async () => {
    expect(await sourcedByPeer([])).toEqual(new Map());
  });
});
