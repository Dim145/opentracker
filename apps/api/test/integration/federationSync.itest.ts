import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import type { FederationPeer } from '@trackarr/db/schema';
import { makeUser } from './helpers';

// Federated catalogue sync.
//
// This is the only place in the project where data written by a third-party
// machine enters the database. The partner is therefore treated as hostile
// input: everything arriving from it is bounded, truncated, filtered. These
// tests pin the two families of guarantee that follow from that.
//
// First, PROGRESS. The cursor is the sync's only memory: advanced wrongly it
// replays the same page forever, advanced too far it silently skips torrents.
// The costliest defect found here was invisible — `toISOString()` truncated
// the cursor to milliseconds while the partner emits microseconds, so the last
// page was refetched on every run.
//
// Second, CONTAINMENT. A partner that overflows (endless pages, oversized
// names, absurd counters, `javascript:` URLs) must be unable to grow the table
// without bound, to bring the sync down, or to inject anything into the UI.
//
// The network is the only thing faked: `signedGet` is replaced by a
// programmable test partner. Everything else — Postgres, the cursor, the
// notifications — is real.

const partner = vi.hoisted(() => ({
  calls: [] as Array<{ path: string; baseUrl: string; params: URLSearchParams }>,
  handlers: {} as Record<
    string,
    (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown }
  >,
}));

vi.mock('../../utils/federation/signing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/federation/signing')>()),
  // `baseUrl` is handed to the handler: several tests stand up two peers and
  // need them to say different things — which is precisely how we prove the
  // writes stay confined to the peer they came from.
  signedGet: async ({ pathname, baseUrl }: { pathname: string; baseUrl: string }) => {
    const [path, qs = ''] = pathname.split('?');
    const params = new URLSearchParams(qs);
    partner.calls.push({ path: path!, baseUrl, params });
    const handler = partner.handlers[path!];
    // By default the partner has nothing to say: one valid, empty page. The
    // side passes of `syncAllCatalogues` are happy with that.
    return handler
      ? handler(params, baseUrl)
      : { status: 200, data: { ok: true, items: [] } };
  },
}));

const { syncPeerCatalogue, syncAllCatalogues } = await import(
  '../../utils/federation/catalogSync'
);
const { ensureFederationIdentity } = await import('../../utils/federation/config');

const CATALOG = '/api/federation/catalog';
const REMOVALS = '/api/federation/catalog-removals';
const REFRESH = '/api/federation/catalog-refresh';
const STATS = '/api/federation/catalog-stats';
const PAGE_LIMIT = 100; // must stay in step with catalogSync.ts
const MAX_PAGES_PER_RUN = 25;

function on(
  resource: string,
  handler: (p: URLSearchParams, baseUrl: string) => { status: number; data: unknown },
): void {
  partner.handlers[resource] = handler;
}

/** One valid catalogue page. */
function page(items: unknown[], nextCursor?: unknown) {
  return { status: 200, data: { ok: true, items, nextCursor } };
}

/** A plausible catalogue item, shaped like `/api/federation/catalog` emits. */
function item(n: number, over: Record<string, unknown> = {}) {
  return {
    remoteId: `r-${n}`,
    infoHash: String(n).padStart(40, 'a'),
    name: `Remote Release ${n}`,
    size: 1_000_000 * n,
    categorySlug: 'movies',
    categoryType: 'movie',
    seeders: 10,
    leechers: 2,
    completed: 5,
    uploaderName: 'Uploader',
    createdAt: `2026-01-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
    detailUrl: `https://partner.example/t/${n}`,
    downloadUrl: `https://partner.example/dl/${n}`,
    ...over,
  };
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

async function mirrored(peerId: string) {
  return db
    .select()
    .from(schema.remoteTorrents)
    .where(eq(schema.remoteTorrents.peerId, peerId));
}

async function syncState(peerId: string, resource = 'catalog') {
  const [row] = await db
    .select()
    .from(schema.federationSyncState)
    .where(
      and(
        eq(schema.federationSyncState.peerId, peerId),
        eq(schema.federationSyncState.resource, resource),
      ),
    );
  return row ?? null;
}

/** The stored cursor, decoded. */
async function cursor(peerId: string, resource = 'catalog') {
  const st = await syncState(peerId, resource);
  return st?.cursor ? (JSON.parse(st.cursor) as { t: string; id: string | null }) : null;
}

const catalogCalls = () => partner.calls.filter((c) => c.path === CATALOG);

beforeEach(async () => {
  partner.calls.length = 0;
  for (const k of Object.keys(partner.handlers)) delete partner.handlers[k];
  // A real identity: `syncAllCatalogues` only runs its side passes when the
  // instance can sign, so provision the actual keypair rather than faking the
  // configuration.
  await ensureFederationIdentity();
  await db
    .update(schema.federationConfig)
    .set({ enabled: true })
    .where(eq(schema.federationConfig.id, 'singleton'));
});

describe('cursor — the sync memory', () => {
  it('asks for no starting point on the very first run', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: '2026-01-01T00:00:01.000Z', id: 'r-1' }));

    await syncPeerCatalogue(peer);

    const first = catalogCalls()[0]!;
    expect(first.params.get('since')).toBeNull();
    expect(first.params.get('sinceId')).toBeNull();
    expect(first.params.get('limit')).toBe(String(PAGE_LIMIT));
  });

  it('persists the cursor the partner returned and sends it back next run', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: '2026-01-01T00:00:01.000Z', id: 'r-1' }));

    await syncPeerCatalogue(peer);
    expect(await cursor(peer.id)).toEqual({ t: '2026-01-01T00:00:01.000Z', id: 'r-1' });

    await syncPeerCatalogue(peer);
    const second = catalogCalls()[1]!;
    expect(second.params.get('since')).toBe('2026-01-01T00:00:01.000Z');
    expect(second.params.get('sinceId')).toBe('r-1');
  });

  it('keeps the microsecond precision of the cursor', async () => {
    // The costliest defect in this sync: the partner compares `created_at` at
    // microsecond precision, but the cursor went through `toISOString()`,
    // which truncates to milliseconds. Sent back rounded down, it pulled the
    // same last page forever.
    const peer = await makePeer();
    const precise = '2026-01-02T03:04:05.123456Z';
    on(CATALOG, () => page([item(1)], { createdAt: precise, id: 'r-1' }));

    await syncPeerCatalogue(peer);
    expect((await cursor(peer.id))!.t).toBe(precise);

    await syncPeerCatalogue(peer);
    expect(catalogCalls()[1]!.params.get('since')).toBe(precise);
  });

  it('accepts a legacy bare-ISO cursor', async () => {
    // Instances predating the composite cursor stored a plain ISO string. An
    // upgrade must not start over from scratch.
    const peer = await makePeer();
    await db.insert(schema.federationSyncState).values({
      peerId: peer.id,
      resource: 'catalog',
      cursor: '2026-01-01T00:00:00.000Z',
    });
    on(CATALOG, () => page([]));

    await syncPeerCatalogue(peer);

    const first = catalogCalls()[0]!;
    expect(first.params.get('since')).toBe('2026-01-01T00:00:00.000Z');
    expect(first.params.get('sinceId')).toBeNull();
  });

  it('neither advances nor breaks on an unreadable cursor', async () => {
    // An invalid date used to bring the whole peer sync down. Not advancing is
    // the right fallback: we will redo the page, we will not skip it.
    const peer = await makePeer();
    on(CATALOG, () => page([item(1)], { createdAt: 'not-a-date', id: 'r-1' }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('ok');
    expect(await cursor(peer.id)).toBeNull();
    expect(await mirrored(peer.id)).toHaveLength(1);
  });
});

describe('pagination', () => {
  it('follows a full page with another and stops on a partial one', async () => {
    const peer = await makePeer();
    let call = 0;
    on(CATALOG, () => {
      call++;
      const n = call === 1 ? PAGE_LIMIT : 3;
      const start = (call - 1) * PAGE_LIMIT;
      return page(
        Array.from({ length: n }, (_, i) => item(start + i)),
        { createdAt: `2026-01-0${call}T00:00:00.000Z`, id: `r-${start + n - 1}` },
      );
    });

    const res = await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(2);
    expect(res.synced).toBe(PAGE_LIMIT + 3);
  });

  it('caps the number of pages per run', async () => {
    // A partner with a huge backlog — or one that returns full pages forever —
    // is drained over several cron ticks rather than monopolising this one.
    const peer = await makePeer();
    let call = 0;
    on(CATALOG, () => {
      call++;
      const start = (call - 1) * PAGE_LIMIT;
      return page(
        Array.from({ length: PAGE_LIMIT }, (_, i) => item(start + i)),
        { createdAt: '2026-01-01T00:00:00.000Z', id: `r-${start + PAGE_LIMIT - 1}` },
      );
    });

    await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(MAX_PAGES_PER_RUN);
    // The cursor stays where we stopped: the next tick resumes exactly there,
    // with neither a gap nor a duplicate.
    expect((await cursor(peer.id))!.id).toBe(`r-${MAX_PAGES_PER_RUN * PAGE_LIMIT - 1}`);
  });

  it('stops dead on an empty page', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([]));

    const res = await syncPeerCatalogue(peer);

    expect(catalogCalls()).toHaveLength(1);
    expect(res.synced).toBe(0);
  });
});

describe('mirror — dedup and integrity', () => {
  it('creates one row per remoteId and updates it on the next pass', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(1, { name: 'Initial version', seeders: 1 })]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([item(1, { name: 'Corrected version', seeders: 42 })]));
    await syncPeerCatalogue(peer);

    const rows = await mirrored(peer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('Corrected version');
    expect(rows[0]!.seeders).toBe(42);
  });

  it('lets two partners mirror the same infoHash', async () => {
    // The same torrent often circulates on several instances. Each mirror
    // belongs to its peer: deduplicating on the infoHash would erase the
    // competing source along with its download link.
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(7)]));

    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    expect(await mirrored(a.id)).toHaveLength(1);
    expect(await mirrored(b.id)).toHaveLength(1);
  });

  it('skips an incomplete item without losing the rest of the page', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1),
        { remoteId: 'no-hash', name: 'x' },
        { infoHash: 'b'.repeat(40), name: 'no id' },
        { remoteId: 'r-9', infoHash: 'c'.repeat(40) }, // no name
        item(2),
      ]),
    );

    const res = await syncPeerCatalogue(peer);

    expect(res.synced).toBe(2);
    expect(await mirrored(peer.id)).toHaveLength(2);
  });
});

describe('series position — what a mirrored season knows about itself', () => {
  // The grouped catalogue files television under `(work, season, episode)`.
  // Those two numbers are columns, not something derivable at display time
  // without re-parsing every name on every page, so they have to cross the
  // federation with the release. They were added to `torrents` before they
  // were added to the feed, which is exactly the kind of omission that shows
  // up as "the partner's episodes all landed in season unknown".

  it('mirrors the position the partner sends', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([item(1, { name: 'Show.S03E07.1080p-NTb', season: 3, episode: 7 })]),
    );

    await syncPeerCatalogue(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(3);
    expect(row!.episode).toBe(7);
  });

  it('re-derives it from the name when an older partner omits it', async () => {
    // A mesh is mixed-version by nature. Without this fallback every
    // television release from an instance predating the field would mirror as
    // "season unknown" — and it is the same parser the local catalogue uses,
    // so the release reads identically whichever side it came from.
    const peer = await makePeer();
    on(CATALOG, () => page([item(2, { name: 'Show.S02E05.2160p.WEB-DL-NTb' })]));

    await syncPeerCatalogue(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(2);
    expect(row!.episode).toBe(5);
  });

  it('reads a season pack as a season with no episode', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(3, { name: 'Show.S01.COMPLETE.1080p-GRP' })]));

    await syncPeerCatalogue(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(1);
    expect(row!.episode).toBeNull();
  });

  it('leaves a film with no position', async () => {
    const peer = await makePeer();
    on(CATALOG, () => page([item(4, { name: 'Some.Film.2011.1080p.BluRay-A' })]));

    await syncPeerCatalogue(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBeNull();
    expect(row!.episode).toBeNull();
  });

  it('refuses a position a partner made up', async () => {
    // Anything that is not a plausible number is dropped rather than stored:
    // a float or a five-digit season would file the release under a bucket
    // the group page can never show.
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(5, { name: 'Unreadable.Upload', season: 1.5, episode: -3 }),
        item(6, { name: 'Also.Unreadable', season: 99_999 }),
        item(7, { name: 'And.Again', season: 'three' }),
      ]),
    );

    await syncPeerCatalogue(peer);

    for (const row of await mirrored(peer.id)) {
      expect(row.season, row.name).toBeNull();
      expect(row.episode, row.name).toBeNull();
    }
  });

  it('prefers the partner over the parser when the two disagree', async () => {
    // The partner saw the upload form: an uploader may have corrected what
    // the parser guessed, and that correction is the better answer.
    const peer = await makePeer();
    on(CATALOG, () =>
      page([item(8, { name: 'Show.S09E09.1080p-NTb', season: 1, episode: 2 })]),
    );

    await syncPeerCatalogue(peer);

    const [row] = await mirrored(peer.id);
    expect(row!.season).toBe(1);
    expect(row!.episode).toBe(2);
  });
});

describe('containing a hostile partner', () => {
  it('stores http(s) URLs only', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, { detailUrl: 'javascript:alert(1)', downloadUrl: 'data:text/html,x' }),
        item(2, { detailUrl: 'https://ok.example/t/2', downloadUrl: 'http://ok.example/dl/2' }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const rows = (await mirrored(peer.id)).sort((x, y) =>
      x.remoteId.localeCompare(y.remoteId),
    );

    // Both of these columns end up in a `:href` in the UI.
    expect(rows[0]!.remoteDetailUrl).toBeNull();
    expect(rows[0]!.remoteDownloadUrl).toBeNull();
    expect(rows[1]!.remoteDetailUrl).toBe('https://ok.example/t/2');
    expect(rows[1]!.remoteDownloadUrl).toBe('http://ok.example/dl/2');
  });

  it('clamps absurd counters to what the column can hold', async () => {
    // `seeders` is a Postgres `integer`: a value beyond 2^31 fails the INSERT
    // and takes the whole page down with it.
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, {
          seeders: -5,
          leechers: 9e18,
          completed: Number.NaN,
          size: -1,
        }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const [row] = await mirrored(peer.id);

    expect(row!.seeders).toBe(0);
    expect(row!.leechers).toBe(2_147_483_647);
    expect(row!.completed).toBe(0);
    expect(row!.size).toBe(0);
  });

  it('truncates oversized fields instead of rejecting them', async () => {
    const peer = await makePeer();
    on(CATALOG, () =>
      page([
        item(1, {
          name: 'N'.repeat(5000),
          description: 'D'.repeat(50_000),
          tags: [...Array.from({ length: 80 }, (_, i) => `tag${i}`), 42, null, { x: 1 }],
        }),
      ]),
    );

    await syncPeerCatalogue(peer);
    const [row] = await mirrored(peer.id);

    expect(row!.name).toHaveLength(1000);
    expect(row!.description).toHaveLength(20_000);
    expect(row!.tags).toHaveLength(50);
    expect(row!.tags!.every((t) => typeof t === 'string')).toBe(true);
  });

  it('refuses to go past the per-partner row cap', async () => {
    // Last-resort guard: past 100 000 mirrored rows we stop pulling from this
    // peer. Without it, a malicious partner grows the table until the disk
    // fills up.
    const peer = await makePeer();
    await db.execute(sql`
      INSERT INTO remote_torrents (id, peer_id, remote_id, info_hash, name, size)
      SELECT gen_random_uuid()::text, ${peer.id}, 'bulk-' || g, lpad(g::text, 40, '0'),
             'Bulk ' || g, 0
      FROM generate_series(1, 100000) g
    `);
    on(CATALOG, () => page([item(1)]));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('ok');
    expect(res.synced).toBe(0);
    expect(catalogCalls()).toHaveLength(0); // we do not even call the peer
    expect((await syncState(peer.id))!.lastError).toMatch(/row cap/i);
  });
});

describe('transport errors', () => {
  it('records the failure on the peer and does not advance the cursor', async () => {
    const peer = await makePeer();
    on(CATALOG, () => ({ status: 502, data: { ok: false, message: 'bad gateway' } }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(await cursor(peer.id)).toBeNull();
    const st = await syncState(peer.id);
    expect(st!.lastStatus).toBe('error');
    expect(st!.lastError).toMatch(/bad gateway/);

    const [row] = await db
      .select()
      .from(schema.federationPeers)
      .where(eq(schema.federationPeers.id, peer.id));
    expect(row!.lastError).toMatch(/Catalogue sync/);
  });

  it('keeps the page already taken in when the next one fails', async () => {
    // A cut mid-run must neither lose the work already done nor leave the
    // cursor ahead of the data actually written — otherwise the next tick
    // would skip the missing page.
    const peer = await makePeer();
    let call = 0;
    on(CATALOG, () => {
      call++;
      if (call === 1) {
        return page(
          Array.from({ length: PAGE_LIMIT }, (_, i) => item(i)),
          { createdAt: '2026-01-01T00:00:00.000Z', id: `r-${PAGE_LIMIT - 1}` },
        );
      }
      return { status: 500, data: { ok: false, message: 'boom' } };
    });

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(res.synced).toBe(PAGE_LIMIT);
    expect(await mirrored(peer.id)).toHaveLength(PAGE_LIMIT);
    expect((await cursor(peer.id))!.id).toBe(`r-${PAGE_LIMIT - 1}`);
  });

  it('treats a malformed response as an error, not as an empty page', async () => {
    // `{ok:true}` with no `items` array does not mean "nothing new": taking it
    // for the end of the feed would mark the sync successful and hide a broken
    // partner.
    const peer = await makePeer();
    on(CATALOG, () => ({ status: 200, data: { ok: true } }));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
  });
});

describe('notifying followers', () => {
  async function follow(userId: string, peerId: string, uploader: string) {
    await db.insert(schema.federatedFollows).values({
      id: randomUUID(),
      localUserId: userId,
      peerId,
      remoteUsername: uploader,
    });
  }

  async function notices(userId: string) {
    return db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId));
  }

  it('stays silent on the very first run', async () => {
    // The first run pulls the partner's entire catalogue. Notifying on it
    // would fire thousands of alerts at once for torrents that are not new.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page(Array.from({ length: 5 }, (_, i) => item(i))));

    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('tells the follower from the next run onwards', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([item(2)]));
    await syncPeerCatalogue(peer);

    const received = await notices(user);
    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe('federated_followed_upload');
    expect((received[0]!.payload as Record<string, unknown>).uploaderName).toBe('Uploader');
  });

  it('does not re-notify a torrent that was merely refreshed', async () => {
    // The distinction rests on `xmax = 0`: only a real INSERT counts as new.
    // Without it every stats refresh would ring the bell again.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);
    await syncPeerCatalogue(peer); // same item, taken in again
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('does not tell a follower about a different uploader', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'SomebodyElse');
    on(CATALOG, () => page([item(1)]));
    await syncPeerCatalogue(peer);
    on(CATALOG, () => page([item(2)]));
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(0);
  });

  it('caps the burst a partner can trigger', async () => {
    // A peer fabricating 500 uploads from a followed uploader must not be able
    // to trigger 500 notifications — and as many emails.
    const peer = await makePeer();
    const user = await makeUser();
    await follow(user, peer.id, 'Uploader');
    on(CATALOG, () => page([item(0)]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page(Array.from({ length: 60 }, (_, i) => item(i + 100))));
    await syncPeerCatalogue(peer);

    expect(await notices(user)).toHaveLength(25);
  });
});

describe('side passes — removals, refresh, stats', () => {
  it('deletes the rows the tombstones name, for that peer only', async () => {
    // The catalogue sync only moves forward: without this feed, a deletion or
    // a ban on the partner would leave an orphaned mirror with a dead link.
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(1), item(2)]));
    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    partner.calls.length = 0;
    on(CATALOG, () => page([]));
    on(REMOVALS, (_p, base) =>
      base === a.baseUrl
        ? page([{ remoteId: 'r-1' }], { t: '2026-02-01T00:00:00.000Z', id: 'x' })
        : page([]),
    );

    const res = await syncAllCatalogues();

    expect(res.removed).toBeGreaterThanOrEqual(1);
    expect((await mirrored(a.id)).map((r) => r.remoteId)).toEqual(['r-2']);
    // Peer B holds the same remoteId: it must not be swept along.
    expect((await mirrored(b.id)).map((r) => r.remoteId).sort()).toEqual(['r-1', 'r-2']);
    expect(await cursor(a.id, 'catalog_removals')).toEqual({
      t: '2026-02-01T00:00:00.000Z',
      id: 'x',
    });
  });

  it('reapplies corrected metadata without counting it as new', async () => {
    const peer = await makePeer();
    const user = await makeUser();
    await db.insert(schema.federatedFollows).values({
      id: randomUUID(),
      localUserId: user,
      peerId: peer.id,
      remoteUsername: 'Uploader',
    });
    on(CATALOG, () => page([item(1, { name: 'Wrong title' })]));
    await syncPeerCatalogue(peer);

    on(CATALOG, () => page([]));
    on(REFRESH, () => page([item(1, { name: 'Fixed title' })], {
      t: '2026-02-01T00:00:00.000Z',
      id: 'r-1',
    }));

    await syncAllCatalogues();

    const [row] = await mirrored(peer.id);
    expect(row!.name).toBe('Fixed title');
    // A correction is not a release: nobody is told about it.
    const received = await db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, user));
    expect(received).toHaveLength(0);
  });

  it('refreshes swarm counts by infoHash, peer by peer', async () => {
    const a = await makePeer();
    const b = await makePeer();
    on(CATALOG, () => page([item(1, { seeders: 1, leechers: 1, completed: 1 })]));
    await syncPeerCatalogue(a);
    await syncPeerCatalogue(b);

    on(CATALOG, () => page([]));
    on(STATS, (_p, base) =>
      // Only peer A publishes stats; B keeps its own.
      base === a.baseUrl
        ? page(
            [{ infoHash: item(1).infoHash, seeders: 99, leechers: 7, completed: 3 }],
            { t: '2026-02-01T00:00:00.000Z', id: 'r-1' },
          )
        : page([]),
    );

    await syncAllCatalogues();

    const [rowA] = await mirrored(a.id);
    const [rowB] = await mirrored(b.id);
    expect(rowA!.seeders).toBe(99);
    expect(rowA!.leechers).toBe(7);
    expect(rowB!.seeders).toBe(1); // the other peer has not moved
  });

  it('only queries active peers that share their catalogue', async () => {
    const active = await makePeer();
    await makePeer({ status: 'suspended' });
    await makePeer({
      acceptsFromThem: { catalog: false, social: true, accounts: false, swarm: false },
    });
    on(CATALOG, () => page([item(1)]));

    const res = await syncAllCatalogues();

    expect(res.peers).toBe(1);
    expect(await mirrored(active.id)).toHaveLength(1);
  });

  it('pulls nothing while federation is switched off', async () => {
    const peer = await makePeer();
    await db
      .update(schema.federationConfig)
      .set({ enabled: false })
      .where(eq(schema.federationConfig.id, 'singleton'));
    on(CATALOG, () => page([item(1)]));

    const res = await syncPeerCatalogue(peer);

    expect(res.status).toBe('error');
    expect(catalogCalls()).toHaveLength(0);
    expect(await mirrored(peer.id)).toHaveLength(0);
  });
});
