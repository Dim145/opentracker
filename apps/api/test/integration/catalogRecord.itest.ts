import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { verifyRecord } from '../../utils/federation/record';
import {
  mintRecords,
  mintTombstone,
  type MintContext,
  pruneSupersededRecords,
} from '../../utils/federation/catalogRecord';
import { publishedSet } from '../../utils/federation/recordSet';
import { MIN_BOUND, fingerprint } from '../../utils/federation/rbsr';

// Minting signed records out of the local catalogue.
//
// One property decides whether any of this is usable, and it is not
// cryptographic: **an unchanged torrent must mint nothing.** A record's id is
// the hash of its content, so anything that varies between two sweeps over an
// unchanged row — a key that is sometimes absent, an array in whatever order
// Postgres returned it, a clock read — produces a new record every sweep. The
// signatures would all be valid and every partner would re-download the entire
// catalogue, forever, with nothing in the logs to say why.
//
// The rest of the file is the lifecycle that follows from immutability: an
// edit is a new record pointing at the old one, and a withdrawal is a
// statement rather than an absence.

let ctx: MintContext;
let counter = 0;

function keypair(): MintContext {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    did: didKeyFromPublicKey(
      publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    ),
    publicUrl: 'https://origin.example',
  };
}

async function makeTorrent(
  over: Partial<typeof schema.torrents.$inferInsert> = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.torrents).values({
    id,
    infoHash: (counter++).toString(16).padStart(40, 'd'),
    name: 'Show.S01E01.1080p.WEB-DL-NTb',
    size: 2_540_000_000,
    moderationStatus: 'accepted',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  });
  return id;
}

async function currentRecord(torrentId: string) {
  const [row] = await db
    .select()
    .from(schema.catalogRecords)
    .where(
      and(
        eq(schema.catalogRecords.torrentId, torrentId),
        isNull(schema.catalogRecords.supersededAt),
      ),
    );
  return row;
}

async function allRecords(torrentId: string) {
  return db
    .select()
    .from(schema.catalogRecords)
    .where(eq(schema.catalogRecords.torrentId, torrentId))
    .orderBy(schema.catalogRecords.createdAt, schema.catalogRecords.id);
}

beforeEach(() => {
  ctx = keypair();
  counter = 0;
});

describe('mintRecords', () => {
  it('mints one verifiable record per torrent', async () => {
    const id = await makeTorrent();
    const out = await mintRecords([id], ctx);
    expect(out).toEqual({ minted: 1, unchanged: 0 });

    const row = await currentRecord(id);
    expect(row!.id.startsWith('sha256:')).toBe(true);
    expect(row!.issuer).toBe(ctx.did);
    expect(row!.kind).toBe('torrent');

    // The stored body is what goes on the wire, so it has to verify exactly as
    // a partner would verify it — after a JSON round trip, on its own.
    const verdict = verifyRecord(JSON.parse(JSON.stringify(row!.body)));
    expect(verdict.ok).toBe(true);
    expect(verdict.signer).toBe(ctx.did);
  });

  it('mints nothing the second time', async () => {
    // THE test. A sweep over an unchanged catalogue must be free.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const first = await currentRecord(id);

    const out = await mintRecords([id], ctx);
    expect(out).toEqual({ minted: 0, unchanged: 1 });
    expect((await allRecords(id)).length).toBe(1);
    expect((await currentRecord(id))!.id).toBe(first!.id);
  });

  it('mints nothing on a third sweep either, after an edit created a lineage', async () => {
    // The subtle version of the same failure. `trackarr:replaces` is part of
    // the id and differs for every generation, so comparing ids would report
    // an unchanged torrent as changed the moment it had a predecessor — and
    // the catalogue would churn one new record per sweep from then on. The
    // sweep compares a content fingerprint that excludes lineage.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await db
      .update(schema.torrents)
      .set({ name: 'Show.S01E01.2160p.WEB-DL-NTb' })
      .where(eq(schema.torrents.id, id));
    await mintRecords([id], ctx);
    expect((await allRecords(id)).length).toBe(2);

    const out = await mintRecords([id], ctx);
    expect(out).toEqual({ minted: 0, unchanged: 1 });
    expect((await allRecords(id)).length).toBe(2);
  });

  it('is not disturbed by the order tags come back in', async () => {
    // `array_agg` has no inherent order. An unsorted tag list would mint a new
    // record whenever Postgres felt like returning them differently — which is
    // the kind of instability that shows up as mysterious churn weeks later.
    const id = await makeTorrent();
    const tagIds: string[] = [];
    for (const name of ['MULTI', '2160p', 'REMUX']) {
      const tagId = randomUUID();
      await db.insert(schema.tags).values({ id: tagId, name, slug: `${name}-${tagId.slice(0, 6)}` });
      tagIds.push(tagId);
    }
    await db
      .insert(schema.torrentTags)
      .values(tagIds.map((tagId) => ({ torrentId: id, tagId })));

    await mintRecords([id], ctx);
    const first = await currentRecord(id);
    expect((first!.body as Record<string, unknown>)['trackarr:tags']).toEqual([
      '2160p',
      'MULTI',
      'REMUX',
    ]);

    // Rewrite the join rows in a different physical order.
    await db.delete(schema.torrentTags).where(eq(schema.torrentTags.torrentId, id));
    await db
      .insert(schema.torrentTags)
      .values([...tagIds].reverse().map((tagId) => ({ torrentId: id, tagId })));

    expect(await mintRecords([id], ctx)).toEqual({ minted: 0, unchanged: 1 });
  });

  it('mints a successor when the metadata changes, and links it', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const first = await currentRecord(id);

    await db
      .update(schema.torrents)
      .set({ tmdbId: 'tv/82856', season: 1, episode: 1 })
      .where(eq(schema.torrents.id, id));
    expect(await mintRecords([id], ctx)).toEqual({ minted: 1, unchanged: 0 });

    const second = await currentRecord(id);
    expect(second!.id).not.toBe(first!.id);
    expect(second!.supersedes).toBe(first!.id);
    // The lineage is inside the signature, so it cannot be rewritten by
    // whoever relays the record.
    expect((second!.body as Record<string, unknown>)['trackarr:replaces']).toBe(
      first!.id,
    );
    expect(verifyRecord(second!.body).ok).toBe(true);

    // Exactly one current record at a time.
    const all = await allRecords(id);
    expect(all).toHaveLength(2);
    expect(all.filter((r) => r.supersededAt === null)).toHaveLength(1);
  });

  it('keeps perishable numbers out of the record', async () => {
    // A record is immutable and cached forever. A seeder count inside one
    // would mint a new record every time the swarm breathed.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const body = JSON.stringify((await currentRecord(id))!.body);
    for (const forbidden of ['seeder', 'leecher', 'completed', 'moderationStatus']) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('gives two instances different records for the same torrent', async () => {
    // The issuer is part of the content, so "the same release published by two
    // instances" is two records — which is correct: they are two statements,
    // by two parties, each answerable for its own.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const mine = await currentRecord(id);

    await db.delete(schema.catalogRecords);
    await mintRecords([id], keypair());
    const theirs = await currentRecord(id);

    expect(theirs!.id).not.toBe(mine!.id);
  });

  it('handles a batch, and only re-mints what moved', async () => {
    const ids = [await makeTorrent(), await makeTorrent(), await makeTorrent()];
    expect(await mintRecords(ids, ctx)).toEqual({ minted: 3, unchanged: 0 });

    await db
      .update(schema.torrents)
      .set({ size: 999 })
      .where(eq(schema.torrents.id, ids[1]!));

    expect(await mintRecords(ids, ctx)).toEqual({ minted: 1, unchanged: 2 });
  });
});

describe('a record outliving its torrent', () => {
  it('survives the torrent being deleted', async () => {
    // `torrent_id` is deliberately not a foreign key. An `ON DELETE SET NULL`
    // would sever the link at exactly the moment it is needed — leaving
    // nothing to say WHICH release was withdrawn, and no way for the sweep to
    // notice the deletion at all.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await db.delete(schema.torrents).where(eq(schema.torrents.id, id));

    const rows = await allRecords(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.torrentId).toBe(id);
    // Still verifiable, still says what it always said.
    expect(verifyRecord(rows[0]!.body).ok).toBe(true);

    // And it can still be withdrawn, which is the point.
    expect(await mintTombstone(id, ctx)).not.toBeNull();
  });
});

describe('mintTombstone', () => {
  it('withdraws a release with a signed statement, not an absence', async () => {
    // An absence cannot be verified — only a statement can. Without this a
    // hidden torrent stays in every mirror that ever saw it.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const before = await currentRecord(id);

    const stone = await mintTombstone(id, ctx);
    expect(stone).not.toBeNull();
    expect(verifyRecord(stone!).ok).toBe(true);

    const now = await currentRecord(id);
    expect(now!.kind).toBe('tombstone');
    expect(now!.supersedes).toBe(before!.id);
    expect((now!.body as Record<string, unknown>).type).toBe('Tombstone');
  });

  it('does not stack tombstones', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await mintTombstone(id, ctx);

    expect(await mintTombstone(id, ctx)).toBeNull();
    expect((await allRecords(id)).filter((r) => r.kind === 'tombstone')).toHaveLength(1);
  });

  it('says nothing about a torrent it never published', async () => {
    const id = await makeTorrent();
    expect(await mintTombstone(id, ctx)).toBeNull();
    expect(await allRecords(id)).toHaveLength(0);
  });
});

describe('the set a partner reconciles against', () => {
  /**
   * The published set, read through the shipped source. No settle window and
   * no cursor: what a partner compares against is simply what stands, and
   * reconciliation does not care what order any of it was written in.
   */
  async function published(): Promise<string[]> {
    return publishedSet().ids(MIN_BOUND, null, 1000);
  }

  it('holds what stands, not what stood', async () => {
    // A superseded record is history. Its successor carries `replaces`, and a
    // partner learns of the change by finding a new id in the set and losing
    // the old one — no separate "this was edited" message exists or is needed.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const [before] = await published();

    await db
      .update(schema.torrents)
      .set({ name: 'Renamed-A' })
      .where(eq(schema.torrents.id, id));
    await mintRecords([id], ctx);

    const after = await published();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before);
  });

  it('holds a withdrawal as a statement, not as a gap', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await mintTombstone(id, ctx);

    const ids = await published();
    expect(ids).toHaveLength(1);
    const [row] = await db
      .select({ kind: schema.catalogRecords.kind })
      .from(schema.catalogRecords)
      .where(eq(schema.catalogRecords.id, ids[0]!));
    expect(row!.kind).toBe('tombstone');
  });

  it('serves a record the moment it is minted', async () => {
    // The feed this replaces withheld anything younger than five seconds,
    // because a sequence number can be handed out before it is committed and
    // a cursor could step over it. Comparing sets has no such hazard, so the
    // delay is gone — and with it a whole class of "why is this not there
    // yet" that had no visible cause.
    const id = await makeTorrent();
    await mintRecords([id], ctx);

    expect(await published()).toHaveLength(1);
  });

  it('fingerprints exactly as the protocol says it should', async () => {
    // The one that matters. The fingerprint is computed in SQL on this side
    // and in TypeScript on the other; if the two ever disagree, two instances
    // reconcile confidently to a set they do not share, and nothing anywhere
    // reports a problem.
    const ids = [await makeTorrent(), await makeTorrent(), await makeTorrent()];
    await mintRecords(ids, ctx);

    const set = publishedSet();
    const all = await set.ids(MIN_BOUND, null, 1000);
    const summary = await set.summary(MIN_BOUND, null);

    expect(summary.n).toBe(3);
    expect(summary.fp).toBe(fingerprint(all));
  });

  it('fingerprints an empty range the same way in both languages', async () => {
    const set = publishedSet();
    const summary = await set.summary('zzzz', null);
    expect(summary.n).toBe(0);
    expect(summary.fp).toBe(fingerprint([]));
  });

  it('cuts a range into pieces that cover it exactly and agree piece by piece', async () => {
    // A bucket boundary that drifts leaves a sliver of the id space neither
    // side ever compares — records that live there are invisible forever, and
    // both sides report agreement.
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push(await makeTorrent());
    await mintRecords(ids, ctx);

    const set = publishedSet();
    const all = await set.ids(MIN_BOUND, null, 1000);
    const buckets = await set.buckets(MIN_BOUND, null, 8);

    expect(buckets[0]!.lo).toBe(MIN_BOUND);
    expect(buckets[buckets.length - 1]!.hi).toBeNull();
    expect(buckets.reduce((n, b) => n + b.n, 0)).toBe(all.length);
    for (let i = 1; i < buckets.length; i++) {
      // Every piece begins where the last one ended: no overlap, no gap.
      expect(buckets[i]!.lo).toBe(buckets[i - 1]!.hi);
    }
    for (const b of buckets) {
      const inside = all.filter((x) => x >= b.lo && (b.hi === null || x < b.hi));
      expect(inside).toHaveLength(b.n);
      expect(b.fp).toBe(fingerprint(inside));
    }
  });
});

describe('the uploader gets a name of their own', () => {
  // A display name is a caption, not an identity: two instances can both have
  // a `Nova`, a member can rename themselves, and by the second relay hop
  // nobody left in the conversation can resolve the name. A `did:key` is a
  // name nobody else can mint and that still means something once the
  // instance holding the account is gone.

  async function makeUploader(username: string): Promise<string> {
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

  it('mints one on first publication and puts it on the record', async () => {
    const uploader = await makeUploader('Nova');
    const id = await makeTorrent({ uploaderId: uploader });
    await mintRecords([id], ctx);

    const rec = await currentRecord(id);
    const did = (rec!.body as Record<string, unknown>).attributedTo;
    expect(String(did)).toMatch(/^did:key:z6Mk/);

    const [key] = await db
      .select()
      .from(schema.userSigningKeys)
      .where(eq(schema.userSigningKeys.userId, uploader));
    expect(key!.did).toBe(did);
  });

  it('gives one uploader one name across everything they publish', async () => {
    const uploader = await makeUploader('Nova');
    const a = await makeTorrent({ uploaderId: uploader });
    const b = await makeTorrent({ uploaderId: uploader });
    await mintRecords([a, b], ctx);

    const [ra, rb] = [await currentRecord(a), await currentRecord(b)];
    expect((ra!.body as Record<string, unknown>).attributedTo).toBe(
      (rb!.body as Record<string, unknown>).attributedTo,
    );
  });

  it('gives two uploaders different names', async () => {
    const one = await makeTorrent({ uploaderId: await makeUploader('Nova') });
    const two = await makeTorrent({ uploaderId: await makeUploader('Vega') });
    await mintRecords([one, two], ctx);

    expect((await currentRecord(one))!.body.attributedTo).not.toBe(
      (await currentRecord(two))!.body.attributedTo,
    );
  });

  it('does not re-mint a record just because it now carries a DID', async () => {
    // The DID is inside the hashed body, so a key that were regenerated — or
    // simply read back differently — would change the record's id on every
    // sweep and re-publish the whole catalogue, forever. This is the property
    // that whole file exists to protect, applied to the new field.
    const uploader = await makeUploader('Nova');
    const id = await makeTorrent({ uploaderId: uploader });
    await mintRecords([id], ctx);
    const first = await currentRecord(id);

    expect(await mintRecords([id], ctx)).toMatchObject({ minted: 0 });
    expect(await mintRecords([id], ctx)).toMatchObject({ minted: 0 });
    expect((await currentRecord(id))!.id).toBe(first!.id);
  });

  it('leaves a torrent with no uploader unattributed rather than inventing one', async () => {
    const id = await makeTorrent({ uploaderId: null });
    await mintRecords([id], ctx);

    expect((await currentRecord(id))!.body.attributedTo).toBeNull();
    expect(await db.select().from(schema.userSigningKeys)).toHaveLength(0);
  });

  it('creates no key material for a member who has published nothing', async () => {
    // Key material you did not need is key material you have to protect
    // anyway. Nothing is generated until a member's work is actually
    // published — the same rule the instance identity follows.
    await makeUploader('Lurker');
    await mintRecords([], ctx);

    expect(await db.select().from(schema.userSigningKeys)).toHaveLength(0);
  });
});

describe('an uploader who asked not to be named', () => {
  // The account toggle says the name is detached from their releases. Here it
  // has to be decided BEFORE minting, and that is the whole point: a record is
  // signed, content-addressed and relayed, so a name that leaves once cannot
  // be recalled by any later setting. Every other read path can redact on the
  // way out; this one gets a single chance.
  //
  // It moved here when the catalogue feed was replaced by signed records —
  // that feed carried the check and nothing carried it afterwards.

  async function uploader(anonymous: boolean): Promise<string> {
    const id = randomUUID();
    await db.insert(schema.users).values({
      id,
      username: anonymous ? 'ghost' : 'nova',
      authSalt: 'salt',
      authVerifier: 'verifier',
      passkey: id.replace(/-/g, '').slice(0, 30),
      anonymousUploads: anonymous,
    });
    return id;
  }

  it('leaves the name out of the record', async () => {
    const id = await makeTorrent({ uploaderId: await uploader(true) });
    await mintRecords([id], ctx);

    const body = (await currentRecord(id))!.body as Record<string, unknown>;
    expect(body['trackarr:uploaderName']).toBeNull();
    // And nowhere else in the body, either: this is the last chance to check.
    expect(JSON.stringify(body)).not.toContain('ghost');
  });

  it('still names an uploader who did not ask', async () => {
    const id = await makeTorrent({ uploaderId: await uploader(false) });
    await mintRecords([id], ctx);

    const body = (await currentRecord(id))!.body as Record<string, unknown>;
    expect(body['trackarr:uploaderName']).toBe('nova');
  });

  it('withholds the DID too, so the anonymous uploads cannot be correlated', async () => {
    // This used to publish the DID, on the reading that the toggle conceals the
    // NAME and not the pseudonym — a DID being a random key that reveals nothing
    // about the account on its own.
    //
    // It does not hold across the mesh. The DID is stable and permanent per
    // member, so a partner that already mirrors this member's NAMED records
    // holds both halves: one `GROUP BY author_did` re-attaches every "anonymous"
    // release to the name beside it. The toggle promises the name is detached
    // from the releases and that they are not listed under the member; a
    // correlatable pseudonym published next to named records does not keep that
    // promise. Records are immutable, content-addressed and relayed, so this is
    // the last point at which the choice can be honoured.
    //
    // The cost, stated plainly: an anonymous release is no longer gathered under
    // the member's cross-instance identity. That is the trade — and it is the
    // one the member asked for by ticking the box.
    const id = await makeTorrent({ uploaderId: await uploader(true) });
    await mintRecords([id], ctx);

    const body = (await currentRecord(id))!.body as Record<string, unknown>;
    expect(body.attributedTo).toBeNull();
  });

  it('still attributes a release whose uploader did not ask for anonymity', async () => {
    const id = await makeTorrent({ uploaderId: await uploader(false) });
    await mintRecords([id], ctx);

    const body = (await currentRecord(id))!.body as Record<string, unknown>;
    expect(body.attributedTo).toMatch(/^did:key:z/);
  });
});

describe('pruning superseded generations', () => {
  it('does nothing when retention is off', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    // Force a superseded generation.
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date('2020-01-01') })
      .where(eq(schema.catalogRecords.torrentId, id));

    expect(await pruneSupersededRecords(0)).toBe(0);
    expect(await allRecords(id)).toHaveLength(1);
  });

  it('removes an old superseded tail no live record supersedes', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const [old] = await allRecords(id);
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date('2020-01-01') })
      .where(eq(schema.catalogRecords.id, old!.id));

    const removed = await pruneSupersededRecords(30);
    expect(removed).toBe(1);
    expect(await allRecords(id)).toHaveLength(0);
  });

  it('keeps a superseded record a live generation still points at', async () => {
    // The lineage a consumer might walk back must survive.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    const [first] = await allRecords(id);
    // Edit → a live successor whose `supersedes` = first.id.
    await db.update(schema.torrents).set({ name: 'Renamed.1080p' }).where(eq(schema.torrents.id, id));
    await mintRecords([id], ctx);
    await db
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date('2020-01-01') })
      .where(eq(schema.catalogRecords.id, first!.id));

    expect(await pruneSupersededRecords(30)).toBe(0);
  });
});
