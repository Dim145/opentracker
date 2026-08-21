import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';

// The passes a signed record cannot carry.
//
// Everything a partner asserts about a release now travels as an immutable
// signed record. Swarm counts cannot: they change every few minutes, and an
// immutable artefact carrying one would be re-minted every time somebody
// stopped seeding. So they keep their own unsigned feed, which is honest about
// what they are — a hint with a short shelf life, not a claim anybody stands
// behind.
//
// That makes this pass the one place left where a partner writes to our
// database on nothing but the transport's word. Hence the tests: it must be
// able to move numbers on rows we already mirror, and nothing else. It cannot
// create a row, it cannot reach another partner's rows, and it cannot make us
// trust a count enough to act on it.
//
// The network is the only thing faked. Postgres, the cursor and the
// notifications are real.

const partner = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; baseUrl: string; params: URLSearchParams }>,
  handlers: {} as Record<
    string,
    (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown }
  >,
}));

vi.mock('../../utils/federation/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/federation/signing')>()),
  // `baseUrl` reaches the handler so a test can stand up two partners that say
  // different things — which is how we prove the writes stay confined to the
  // partner they came from.
  signedGet: async ({ pathname, baseUrl }: { pathname: string; baseUrl: string }) => {
    const [path, qs = ''] = pathname.split('?');
    const params = new URLSearchParams(qs);
    partner.calls.push({ path: path!, baseUrl, params });
    const handler = partner.handlers[path!];
    return handler
      ? handler(params, baseUrl)
      : { status: 200, data: { ok: true, items: [] } };
  },
}));

const { syncPeerStats } = await import('../../utils/federation/sidePasses');
const { ensureFederationIdentity } = await import('../../utils/federation/config');

const STATS = '/api/federation/catalog-stats';

function on(
  resource: string,
  handler: (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown },
): void {
  partner.handlers[resource] = handler;
}

function page(items: unknown[], nextCursor?: unknown) {
  return { status: 200, data: { ok: true, items, nextCursor } };
}

const SCOPES_CATALOG = {
  catalog: true,
  social: false,
  accounts: false,
  swarm: false,
};

async function makePeer(
  over: Partial<typeof schema.federationPeers.$inferInsert> = {},
): Promise<FederationPeer> {
  const id = randomUUID();
  const [row] = await db
    .insert(schema.federationPeers)
    .values({
      id,
      baseUrl: `https://p-${id.slice(0, 8)}.example`,
      instanceId: `tk_${id.slice(0, 12)}`,
      publicKey: 'PUBKEY',
      displayName: `Peer ${id.slice(0, 4)}`,
      status: 'active',
      sharesWithThem: SCOPES_CATALOG,
      acceptsFromThem: SCOPES_CATALOG,
      ...over,
    })
    .returning();
  return row!;
}

const HASH = 'a'.repeat(40);

/** A mirrored row, as the record sync would have left it. */
async function mirror(peer: FederationPeer, over: Record<string, unknown> = {}) {
  const [row] = await db
    .insert(schema.remoteTorrents)
    .values({
      id: randomUUID(),
      peerId: peer.id,
      remoteId: `sha256:${randomUUID().replace(/-/g, '')}`,
      infoHash: HASH,
      name: 'Mirrored Release',
      size: 1_000,
      seeders: 1,
      leechers: 1,
      completed: 1,
      ...over,
    } as typeof schema.remoteTorrents.$inferInsert)
    .returning();
  return row!;
}

async function mirrored(peerId: string) {
  return db
    .select()
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peerId));
}

async function cursor(peerId: string) {
  const [row] = await db
    .select()
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peerId),
        eq(schema.federationSyncState.resource, 'catalog_stats'),
      ),
    );
  return row?.cursor ? (JSON.parse(row.cursor) as { t: string; id: string | null }) : null;
}

beforeEach(async () => {
  partner.calls.length = 0;
  for (const k of Object.keys(partner.handlers)) delete partner.handlers[k];
  // A real identity: the pass refuses to run without one, as it should.
  await ensureFederationIdentity();
  await db
    .update(schema.federationConfig)
    .set({ enabled: true })
    .where(eq(schema.federationConfig.id, 'singleton'));
});

describe('swarm counts', () => {
  it('refreshes the numbers on rows we already mirror', async () => {
    const peer = await makePeer();
    await mirror(peer);
    on(STATS, () =>
      page([{ infoHash: HASH, seeders: 99, leechers: 7, completed: 3 }], {
        t: '2026-02-01T00:00:00.000Z',
        id: 'r-1',
      }),
    );

    const updated = await syncPeerStats(peer);

    expect(updated).toBe(1);
    const [row] = await mirrored(peer.id);
    expect(row!.seeders).toBe(99);
    expect(row!.leechers).toBe(7);
    expect(row!.completed).toBe(3);
  });

  it('leaves another partner\'s copy of the same release alone', async () => {
    // Two partners can mirror one info hash. A count is a statement about the
    // swarm as one of them sees it, so it must not leak across.
    const a = await makePeer();
    const b = await makePeer();
    await mirror(a);
    await mirror(b);
    on(STATS, (_p, base) =>
      base === a.baseUrl
        ? page([{ infoHash: HASH, seeders: 99, leechers: 7, completed: 3 }])
        : page([]),
    );

    await syncPeerStats(a);
    await syncPeerStats(b);

    expect((await mirrored(a.id))[0]!.seeders).toBe(99);
    expect((await mirrored(b.id))[0]!.seeders).toBe(1);
  });

  it('cannot conjure a release out of a stats page', async () => {
    // The pass is unsigned, so it is deliberately incapable of creating
    // anything: a count for a release we never mirrored is discarded. Without
    // this, the one unauthenticated feed left would be an insertion path.
    const peer = await makePeer();
    on(STATS, () =>
      page([{ infoHash: 'b'.repeat(40), seeders: 500, leechers: 0, completed: 0 }]),
    );

    const updated = await syncPeerStats(peer);

    expect(updated).toBe(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });

  it('remembers where it stopped, to the microsecond', async () => {
    // The costliest defect ever found in this file was invisible: a cursor
    // truncated to milliseconds refetched its last page on every run.
    const peer = await makePeer();
    await mirror(peer);
    on(STATS, () =>
      page([{ infoHash: HASH, seeders: 5, leechers: 0, completed: 0 }], {
        t: '2026-02-01T10:00:00.123456',
        id: 'r-9',
      }),
    );

    await syncPeerStats(peer);
    expect(await cursor(peer.id)).toEqual({
      t: '2026-02-01T10:00:00.123456',
      id: 'r-9',
    });

    partner.calls.length = 0;
    await syncPeerStats(peer);
    expect(partner.calls[0]!.params.get('since')).toBe('2026-02-01T10:00:00.123456');
    expect(partner.calls[0]!.params.get('sinceId')).toBe('r-9');
  });

  it('survives a partner that is down', async () => {
    const peer = await makePeer();
    await mirror(peer);
    on(STATS, () => ({ status: 502, data: null }));

    await expect(syncPeerStats(peer)).resolves.toBe(0);

    expect((await mirrored(peer.id))[0]!.seeders).toBe(1); // untouched
  });

  it('asks nothing while federation is off', async () => {
    const peer = await makePeer();
    await db
      .update(schema.federationConfig)
      .set({ enabled: false })
      .where(eq(schema.federationConfig.id, 'singleton'));
    on(STATS, () => page([{ infoHash: HASH, seeders: 99 }]));

    expect(await syncPeerStats(peer)).toBe(0);
    expect(partner.calls).toHaveLength(0);
  });
});
