import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from '../../utils/federation/did';
import { verifyRecord } from '../../utils/federation/record';
import {
  SETTLE_SECONDS,
  listRecordsSince,
  mintRecords,
  mintTombstone,
  type MintContext,
} from '../../utils/federation/catalogRecord';

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
    .orderBy(schema.catalogRecords.seq);
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

describe('the record stream', () => {
  /** Records are withheld for a few seconds; tests cannot wait for that. */
  async function age(): Promise<void> {
    await db.execute(
      sql`UPDATE catalog_records
             SET created_at = now() - interval '${sql.raw(String(SETTLE_SECONDS + 5))} seconds'`,
    );
  }

  it('walks forward by seq, oldest first', async () => {
    const ids = [await makeTorrent(), await makeTorrent(), await makeTorrent()];
    await mintRecords(ids, ctx);
    await age();

    const first = await listRecordsSince(0, 2);
    expect(first.records).toHaveLength(2);
    expect(first.nextCursor).toBeGreaterThan(0);

    const second = await listRecordsSince(first.nextCursor, 2);
    expect(second.records).toHaveLength(1);

    // No overlap and nothing missed: three records across the two pages.
    const seen = new Set(
      [...first.records, ...second.records].map((r) => (r as { id: string }).id),
    );
    expect(seen.size).toBe(3);
  });

  it('serves what stands, not what stood', async () => {
    // A superseded record is history. Its successor carries `replaces` and
    // arrives with a higher seq, so a partner learns of the change without
    // ever being sent the old one.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await db
      .update(schema.torrents)
      .set({ name: 'Renamed-A' })
      .where(eq(schema.torrents.id, id));
    await mintRecords([id], ctx);
    await age();

    const { records } = await listRecordsSince(0, 50);
    expect(records).toHaveLength(1);
    expect((records[0] as { name: string }).name).toBe('Renamed-A');
    expect((records[0] as Record<string, unknown>)['trackarr:replaces']).toBeTruthy();
  });

  it('serves a withdrawal as a statement, not as a gap', async () => {
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await mintTombstone(id, ctx);
    await age();

    const { records } = await listRecordsSince(0, 50);
    expect(records).toHaveLength(1);
    expect((records[0] as { type: string }).type).toBe('Tombstone');
  });

  it('withholds a record until concurrent writers have committed', async () => {
    // `seq` is a sequence, and a sequence is not a safe cursor: two
    // transactions can take 5 and 6 and commit in the other order, so a reader
    // paging strictly past the highest seq it saw would miss 5 forever. The
    // settle window is what makes that vanishingly unlikely — and it is why a
    // freshly minted record is not immediately visible.
    const id = await makeTorrent();
    await mintRecords([id], ctx);

    expect((await listRecordsSince(0, 50)).records).toHaveLength(0);
    await age();
    expect((await listRecordsSince(0, 50)).records).toHaveLength(1);
  });

  it('leaves the cursor where it was when there is nothing new', async () => {
    // A partner that polls an idle instance must not have its cursor reset to
    // zero and re-download the catalogue.
    const id = await makeTorrent();
    await mintRecords([id], ctx);
    await age();
    const { nextCursor } = await listRecordsSince(0, 50);

    const idle = await listRecordsSince(nextCursor, 50);
    expect(idle.records).toHaveLength(0);
    expect(idle.nextCursor).toBe(nextCursor);
  });
});
