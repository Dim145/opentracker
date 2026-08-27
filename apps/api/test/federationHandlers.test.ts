import { describe, it, expect, afterEach } from 'vitest';
import {
  MAX_IDS,
  envelopesFor,
  wantedIds,
  type ServableRow,
  type Signer,
} from '../utils/federation/serveRecords';
import {
  collectionHeader,
  collectionPage,
  PAGE_SIZE,
} from '../utils/federation/activityStreams';
import { absentBecause } from '../utils/federation/discoverable';
import { syncIntervalMs } from '../utils/federation/config';
import type { FederationConfig } from '@trackarr/db/schema';

// The decisions the three federation endpoints make.
//
// Every rule below was, until this file, verified only by my own passes over a
// running mesh — which proves a rule holds today and says nothing about the
// next edit. Two of them are load-bearing for safety: an instance must never
// hand on a record that was already relayed to it, and the public surface must
// be absent unless the operator turned it on. Both lived in a subexpression.

function row(over: Partial<ServableRow> = {}): ServableRow {
  return {
    id: 'sha256:aaaa',
    body: { type: 'Torrent', name: 'Release' },
    origin: 'local',
    hops: 0,
    ...over,
  };
}

/**
 * A signer that records what it was asked to vouch for.
 *
 * `bound: false` stands in for a peer with no `instanceId` — a link that never
 * completed a handshake — where there is nothing to bind the vouching to.
 */
function signer(bound = true): { asked: string[]; signer: Signer } {
  const asked: string[] = [];
  const proof = (id: string, audience?: string) => ({
    type: 'DataIntegrityProof' as const,
    cryptosuite: 'eddsa-jcs-2022' as const,
    created: '2026-05-01T00:00:00Z',
    verificationMethod: 'did:key:zUs#zUs',
    proofPurpose: 'assertionMethod' as const,
    proofValue: `z${id}${audience ? `:${audience}` : ''}`,
  });
  return {
    asked,
    signer: {
      did: 'did:key:zUs',
      countersign: (id: string) => {
        asked.push(id);
        return {
          relay: proof(id),
          audience: bound ? proof(id, 'them') : null,
        };
      },
    },
  };
}

describe('the ids a request may ask for', () => {
  it('takes a plain list', () => {
    expect(wantedIds({ ids: ['sha256:a', 'sha256:b'] })).toEqual([
      'sha256:a',
      'sha256:b',
    ]);
  });

  it('asks for each one once', () => {
    // A partner repeating an id costs us a row in the response for nothing.
    expect(wantedIds({ ids: ['sha256:a', 'sha256:a', 'sha256:a'] })).toEqual([
      'sha256:a',
    ]);
  });

  it('serves the good ids in a request that also holds rubbish', () => {
    // Dropped, not refused. Four hundred valid ids and one integer should
    // return four hundred records, not a 400.
    expect(
      wantedIds({ ids: ['sha256:a', 42, null, {}, ' ', '  sha256:b  '] }),
    ).toEqual(['sha256:a', 'sha256:b']);
  });

  it('caps the work one request can ask for', () => {
    const many = Array.from({ length: MAX_IDS + 250 }, (_, i) => `sha256:${i}`);
    expect(wantedIds({ ids: many })).toHaveLength(MAX_IDS);
  });

  it('refuses an id long enough to be an attack rather than an address', () => {
    expect(wantedIds({ ids: ['x'.repeat(129)] })).toEqual([]);
  });

  it('reads anything else as asking for nothing', () => {
    for (const body of [{}, { ids: 'sha256:a' }, { ids: null }, null, 7, []]) {
      expect(wantedIds(body)).toEqual([]);
    }
  });
});

describe('what we will hand over, and under whose name', () => {
  const { signer: s, asked } = signer();

  it('hands over our own, bare', () => {
    const out = envelopesFor([row({ id: 'sha256:mine' })], {
      relaying: false,
      signer: s,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.relay).toBeNull();
    expect(asked).not.toContain('sha256:mine');
  });

  it('hands over nothing of anybody else\'s while relaying is off', () => {
    const out = envelopesFor([row({ origin: 'ingested', hops: 1 })], {
      relaying: false,
      signer: s,
    });

    expect(out).toEqual([]);
  });

  it('puts our name to somebody else\'s record when we do hand it on', () => {
    // The countersignature is the whole mechanism: it is what lets the
    // receiver take in a record from an instance it does not federate with.
    const out = envelopesFor([row({ id: 'sha256:theirs', origin: 'ingested', hops: 1 })], {
      relaying: true,
      signer: s,
    });

    expect(out).toHaveLength(1);
    expect(out[0]!.relay).toMatchObject({ proofValue: 'zsha256:theirs' });
    // Both forms go out. The bare one keeps a partner on an older build
    // working; the bound one is what a current partner prefers and what
    // FEDERATION_REQUIRE_AUDIENCE will require. Emitting only the bound one
    // would break relaying toward every partner that rebuilds the statement
    // without it — silently, since a refused record is sourced as rejected and
    // never asked for again.
    expect(out[0]!.relayAudience).toMatchObject({
      proofValue: 'zsha256:theirs:them',
    });
  });

  it('carries no bound vouching for a peer we cannot address', () => {
    // A link that never completed a handshake has no `instanceId`. Binding to a
    // guess would produce a proof that verifies nowhere, so the bare form goes
    // out alone and the receiver takes it unless it requires the binding.
    const s = signer(false);
    const out = envelopesFor([row({ origin: 'ingested', hops: 1 })], {
      relaying: true,
      signer: s.signer,
    });
    expect(out[0]!.relay).toBeTruthy();
    expect(out[0]!.relayAudience).toBeNull();
  });

  it('never hands on what was already relayed to it', () => {
    // The two-hop bound, enforced on this side of the wire. Without this line
    // an introduction chain has no end and "two hops" is a sentence in a
    // document rather than a rule.
    const out = envelopesFor(
      [
        row({ id: 'sha256:first-hand', origin: 'ingested', hops: 1 }),
        row({ id: 'sha256:second-hand', origin: 'ingested', hops: 2 }),
      ],
      { relaying: true, signer: s },
    );

    expect(out).toHaveLength(1);
    expect(out[0]!.relay).toMatchObject({ proofValue: 'zsha256:first-hand' });
  });

  it('still serves our own catalogue on an instance with no key yet', () => {
    // A fresh instance can be asked for records before its identity exists.
    // Ours need no signature, so they still go out.
    const out = envelopesFor([row()], { relaying: true, signer: null });
    expect(out).toHaveLength(1);
    expect(out[0]!.relay).toBeNull();
  });

  it('withholds somebody else\'s rather than passing it on unvouched', () => {
    // Not a silent downgrade: an unsigned relay would be a record the receiver
    // has no reason to accept, so serving it would be pretending to relay.
    const out = envelopesFor([row({ origin: 'ingested', hops: 1 })], {
      relaying: true,
      signer: null,
    });
    expect(out).toEqual([{ record: row().body, relay: null }]);
  });

  it('hands the record over untouched', () => {
    // Its address covers its content. A field added in transit renames it,
    // and the receiver would compute a different id and reject it.
    const body = { type: 'Torrent', name: 'Release', proof: { x: 1 } };
    const out = envelopesFor([row({ body })], { relaying: true, signer: s });
    expect(out[0]!.record).toBe(body);
  });
});

describe('the collection a stranger walks', () => {
  const ID = 'https://alpha.example/api/federation/outbox';

  it('says how many there are and where to start', () => {
    const head = collectionHeader(ID, 120);
    expect(head.type).toBe('OrderedCollection');
    expect(head.totalItems).toBe(120);
    expect(head.first).toBe(`${ID}?page=1`);
  });

  it('links to no first page when there is nothing to read', () => {
    // A link to a page that comes back empty invites a consumer to walk a
    // collection with nothing in it.
    const head = collectionHeader(ID, 0);
    expect(head.totalItems).toBe(0);
    expect(head).not.toHaveProperty('first');
  });

  it('points a page back at the collection it belongs to', () => {
    const page = collectionPage(ID, 2, 500, []);
    expect(page.type).toBe('OrderedCollectionPage');
    expect(page.id).toBe(`${ID}?page=2`);
    expect(page.partOf).toBe(ID);
  });

  it('stops linking onward at the last page', () => {
    // The one that matters: a page that always links to a next page is a
    // collection a well-behaved consumer never finishes reading.
    const last = collectionPage(ID, 2, PAGE_SIZE * 2, []);
    expect(last).not.toHaveProperty('next');
    expect(last.prev).toBe(`${ID}?page=1`);
  });

  it('links onward while there is more', () => {
    const mid = collectionPage(ID, 1, PAGE_SIZE * 2, []);
    expect(mid.next).toBe(`${ID}?page=2`);
    expect(mid).not.toHaveProperty('prev');
  });

  it('links onward when the last page is a partial one', () => {
    // Off-by-one country: with one item spilling past a full page, page 1 must
    // still link onward or that item is unreachable.
    const mid = collectionPage(ID, 1, PAGE_SIZE + 1, []);
    expect(mid.next).toBe(`${ID}?page=2`);
    expect(collectionPage(ID, 2, PAGE_SIZE + 1, [])).not.toHaveProperty('next');
  });

  it('carries the items exactly as given', () => {
    const items = [{ id: 'sha256:a' }, { id: 'sha256:b' }];
    expect(collectionPage(ID, 1, 2, items).orderedItems).toBe(items);
  });
});

describe('whether the public surface exists at all', () => {
  function config(over: Partial<FederationConfig> = {}): FederationConfig {
    return {
      enabled: true,
      discoverable: true,
      publicUrl: 'https://alpha.example',
      publicKey: 'pk',
      privateKeyEnc: 'sk',
      instanceId: 'tk_x',
      ...over,
    } as FederationConfig;
  }

  it('exists when the operator turned it on', () => {
    expect(absentBecause(config())).toBeNull();
  });

  it('is absent while discovery is off, federation or no federation', () => {
    // The important one. Federating with chosen partners is not the same
    // decision as being readable by anyone, and conflating them would publish
    // a private tracker's catalogue on the strength of an unrelated switch.
    expect(absentBecause(config({ discoverable: false }))).toBe('off');
  });

  it('is absent while federation itself is off', () => {
    expect(absentBecause(config({ enabled: false }))).toBe('not-live');
  });

  it('is absent with no public URL to come back to', () => {
    // Every id in these documents is absolute. Serving them from an instance
    // with no address publishes links that resolve to nothing.
    expect(absentBecause(config({ publicUrl: null }))).toBe('no-public-url');
  });

  it('is absent on an instance that has never been configured', () => {
    expect(absentBecause(null)).toBe('not-live');
  });

  it('is absent on an instance whose identity is half-provisioned', () => {
    // Enabled, discoverable, addressable — and no key. The documents would go
    // out advertising a signing key that does not exist, so a consumer could
    // verify nothing it fetched. Being absent is the honest answer.
    expect(absentBecause(config({ publicKey: null }))).toBe('not-live');
  });
});

describe('how often the sync is supposed to run', () => {
  // One setting, two readers, and they disagreed: the cron read
  // `FEDERATION_SYNC_INTERVAL` — the documented name — and the health view
  // read `FEDERATION_SYNC_INTERVAL_MS`, which nothing sets. So the gauge was
  // always drawn against fifteen minutes, and an instance deliberately syncing
  // more slowly than the stale threshold showed every healthy partner as
  // behind, forever.
  const saved = process.env.FEDERATION_SYNC_INTERVAL;
  afterEach(() => {
    if (saved === undefined) delete process.env.FEDERATION_SYNC_INTERVAL;
    else process.env.FEDERATION_SYNC_INTERVAL = saved;
  });

  it('reads the name both guides document', () => {
    process.env.FEDERATION_SYNC_INTERVAL = '20000';
    expect(syncIntervalMs()).toBe(20_000);
  });

  it('falls back to fifteen minutes when unset', () => {
    delete process.env.FEDERATION_SYNC_INTERVAL;
    expect(syncIntervalMs()).toBe(900_000);
  });

  it('ignores a value that would break the gauge', () => {
    // Zero or a typo would make everything instantly "behind", or divide by
    // nothing in the view. A bad setting should be inert, not destructive.
    for (const bad of ['0', '-5', 'soon', '']) {
      process.env.FEDERATION_SYNC_INTERVAL = bad;
      expect(syncIntervalMs()).toBe(900_000);
    }
  });
});
