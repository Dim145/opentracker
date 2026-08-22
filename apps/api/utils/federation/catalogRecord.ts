/**
 * Projecting the local catalogue into signed records.
 *
 * `record.ts` defines what a record IS and how it is signed. This is the other
 * half: turning a row of `torrents` into one, deciding when a new one is owed,
 * and storing it.
 *
 * ## Stability is the whole game
 *
 * A record's id is the hash of its content, so the projection must be a
 * FUNCTION of the torrent and nothing else. Anything that varies between two
 * runs over an unchanged row — a key that is sometimes absent, an array in
 * whatever order Postgres returned it, a timestamp read from the clock —
 * mints a new record every sweep, and every partner re-downloads the whole
 * catalogue every time.
 *
 * Three rules follow, and each of them is a bug avoided:
 *
 * 1. **Every key is always present.** Absent fields are `null`, never omitted.
 *    A varying key set is a varying hash.
 * 2. **Arrays are sorted.** `array_agg` has no inherent order.
 * 3. **Nothing perishable.** Seeders, leechers, completion counts and
 *    moderation state are excluded outright: a record is immutable and cached
 *    forever, and a number that changes hourly inside one would mint a new
 *    record hourly. Swarm figures travel separately, unsigned, as what they
 *    are.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { ensureUserDids } from './userIdentity';
import {
  CONTEXT,
  recordId,
  signRecord,
  type SignedRecord,
  type UnsignedRecord,
} from './record';

/**
 * What this instance is willing to publish.
 *
 * Defined here rather than in the feed on purpose. A feed filter can stop
 * sending something; it cannot un-send it. Once a record is signed and handed
 * to a partner it can be relayed by anyone, forever — so "we no longer publish
 * this" has to be a decision about MINTING, backed by a tombstone, or it is
 * not a decision at all.
 *
 * Three conditions, and the third is the one a filter-only design gets wrong:
 * a banned uploader's content stops federating out. The torrent stays visible
 * locally — moderation is a separate matter — but a banned member's work and
 * name are not propagated.
 */
export const PUBLISHABLE = sql`
  ${schema.torrents.moderationStatus} = 'accepted'
  AND ${schema.torrents.isActive}
  AND NOT EXISTS (
    SELECT 1 FROM ${schema.users}
     WHERE ${schema.users.id} = ${schema.torrents.uploaderId}
       AND ${schema.users.isBanned}
  )`;

/** Everything the projection reads. Nothing else may influence the id. */
export interface TorrentProjection {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  description: string | null;
  categorySlug: string | null;
  categoryType: string | null;
  isAdult: boolean;
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  igdbId: string | null;
  openlibraryId: string | null;
  contentSignature: string | null;
  season: number | null;
  episode: number | null;
  uploaderName: string | null;
  /**
   * `did:key:…` of the uploader. A name nobody else can mint, and one that
   * still means something after the record has been relayed past the instance
   * that holds the account. Null only for a torrent with no uploader on file.
   */
  authorDid: string | null;
  /** `coalesce(moderated_at, created_at)` — when it went live here. */
  liveAt: Date;
  tags: string[];
}

/** Descriptions are capped exactly as the legacy feed capped them. */
const MAX_DESCRIPTION = 20_000;

/**
 * A magnet with no trackers.
 *
 * Deliberately: an announce URL carries a passkey on this software, and a
 * magnet is the part of a record most likely to be copied somewhere public.
 * What remains — the infohash and a display name — is what makes the record
 * recognisable to a consumer that does not speak our vocabulary, which is the
 * entire reason for the FEP-d8c8 shape.
 */
function magnetFor(infoHash: string, name: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
}

export function projectTorrent(
  t: TorrentProjection,
  issuerDid: string,
  /**
   * Where this release can be fetched, on the instance that published it.
   *
   * Inside the record rather than derived from whoever handed it over,
   * because those stop being the same thing the moment a record is relayed:
   * a consumer three hops away has to know where the content actually is, and
   * the relay's own address would send them to a stranger. AS2 `url`, which
   * is also the field FEP-d8c8 points at.
   */
  publicUrl: string | null,
): UnsignedRecord {
  return {
    '@context': CONTEXT,
    type: 'Torrent',

    'bt:infohash_v1': t.infoHash,
    'bt:magnet': magnetFor(t.infoHash, t.name),

    url: publicUrl ? `${publicUrl.replace(/\/$/, '')}/torrents/${t.infoHash}` : null,
    name: t.name,
    content: t.description ? t.description.slice(0, MAX_DESCRIPTION) : null,
    published: t.liveAt.toISOString(),
    // The uploader, as an actor rather than as a caption. A display name is
    // not an identity: two instances can both have a `Nova`, a member can
    // rename themselves, and by the second relay hop nobody in the
    // conversation can resolve the name anyway.
    //
    // Worth being precise about what this claims. The key is held by this
    // instance, so the DID is a stable NAME and not evidence of who did
    // anything — see `userIdentity.ts`. It is exactly as trustworthy as the
    // instance signing the record, which is to say: as trustworthy as the
    // rest of the record.
    attributedTo: t.authorDid,

    'trackarr:size': t.size,
    'trackarr:contentSignature': t.contentSignature,
    'trackarr:category': t.categorySlug,
    'trackarr:categoryType': t.categoryType,
    'trackarr:isAdult': t.isAdult,
    // Sorted: `array_agg` has no inherent order, and an unsorted array would
    // mint a fresh record every time Postgres felt like returning it
    // differently.
    'trackarr:tags': [...t.tags].sort(),
    'trackarr:imdbId': t.imdbId,
    'trackarr:tmdbId': t.tmdbId,
    'trackarr:tvdbId': t.tvdbId,
    'trackarr:igdbId': t.igdbId,
    'trackarr:openlibraryId': t.openlibraryId,
    'trackarr:season': t.season,
    'trackarr:episode': t.episode,
    'trackarr:uploaderName': t.uploaderName,
    'trackarr:issuer': issuerDid,
    'trackarr:replaces': null,
  } as UnsignedRecord;
}

/** A signed statement that a release is no longer offered here. */
export function projectTombstone(
  infoHash: string,
  issuerDid: string,
  supersedes: string,
  at: Date,
): UnsignedRecord {
  return {
    '@context': CONTEXT,
    type: 'Tombstone',
    'bt:infohash_v1': infoHash,
    published: at.toISOString(),
    'trackarr:issuer': issuerDid,
    'trackarr:replaces': supersedes,
  } as unknown as UnsignedRecord;
}

/** Read the rows the projection needs, tags included, for a set of torrents. */
export async function loadProjections(
  torrentIds: string[],
): Promise<TorrentProjection[]> {
  if (!torrentIds.length) return [];

  const rows = await db
    .select({
      id: schema.torrents.id,
      infoHash: schema.torrents.infoHash,
      name: schema.torrents.name,
      size: schema.torrents.size,
      description: schema.torrents.description,
      categorySlug: schema.categories.slug,
      categoryType: schema.categories.type,
      isAdult: schema.categories.isAdult,
      imdbId: schema.torrents.imdbId,
      tmdbId: schema.torrents.tmdbId,
      tvdbId: schema.torrents.tvdbId,
      igdbId: schema.torrents.igdbId,
      openlibraryId: schema.torrents.openlibraryId,
      contentSignature: schema.torrents.contentSignature,
      season: schema.torrents.season,
      episode: schema.torrents.episode,
      uploaderName: schema.users.username,
      uploaderId: schema.torrents.uploaderId,
      liveAt: sql<Date>`coalesce(${schema.torrents.moderatedAt}, ${schema.torrents.createdAt})`,
    })
    .from(schema.torrents)
    .leftJoin(
      schema.categories,
      eq(schema.torrents.categoryId, schema.categories.id),
    )
    .leftJoin(schema.users, eq(schema.torrents.uploaderId, schema.users.id))
    .where(inArray(schema.torrents.id, torrentIds));

  const tagRows = await db
    .select({
      torrentId: schema.torrentTags.torrentId,
      name: schema.tags.name,
    })
    .from(schema.torrentTags)
    .innerJoin(schema.tags, eq(schema.torrentTags.tagId, schema.tags.id))
    .where(inArray(schema.torrentTags.torrentId, torrentIds));

  const tagsBy = new Map<string, string[]>();
  for (const t of tagRows) {
    const list = tagsBy.get(t.torrentId) ?? [];
    list.push(t.name);
    tagsBy.set(t.torrentId, list);
  }

  // One batch for the whole sweep, minting only the keys that do not exist
  // yet. An uploader costs a keypair once and never again.
  const dids = await ensureUserDids(rows.map((r) => r.uploaderId));

  return rows.map(({ uploaderId, ...r }) => ({
    ...r,
    isAdult: !!r.isAdult,
    authorDid: uploaderId ? (dids.get(uploaderId) ?? null) : null,
    liveAt: new Date(r.liveAt as unknown as string),
    tags: tagsBy.get(r.id) ?? [],
  }));
}

export interface MintContext {
  privateKeyPem: string;
  /** `did:key:…` of this instance. */
  did: string;
  /** This instance's public base URL, for the record's `url`. */
  publicUrl: string | null;
}

/**
 * What a torrent SAYS, ignoring what it replaces.
 *
 * The record id covers `trackarr:replaces`, which necessarily differs for
 * every generation — so comparing ids would report an unchanged torrent as
 * changed on every sweep and mint a new record each time, which is the exact
 * failure the whole "stability is the game" rule exists to prevent. The
 * fingerprint is what the sweep compares; the id is what the record is called.
 */
export function contentFingerprint(draft: UnsignedRecord): string {
  return recordId({ ...draft, 'trackarr:replaces': null });
}

export interface MintOutcome {
  minted: number;
  unchanged: number;
}

/**
 * Bring the record set up to date for these torrents.
 *
 * Idempotent by construction: the projection is hashed, and a torrent whose
 * current record already carries that hash is left alone. That is what makes
 * the sweep safe to run on everything, forever — and it is why the projection
 * has to be a pure function of the row.
 */
export async function mintRecords(
  torrentIds: string[],
  ctx: MintContext,
): Promise<MintOutcome> {
  const projections = await loadProjections(torrentIds);
  if (!projections.length) return { minted: 0, unchanged: 0 };

  const current = await db
    .select({
      id: schema.catalogRecords.id,
      contentHash: schema.catalogRecords.contentHash,
      torrentId: schema.catalogRecords.torrentId,
    })
    .from(schema.catalogRecords)
    .where(
      and(
        inArray(schema.catalogRecords.torrentId, torrentIds),
        isNull(schema.catalogRecords.supersededAt),
      ),
    );
  const currentBy = new Map(current.map((c) => [c.torrentId!, c]));

  let minted = 0;
  let unchanged = 0;

  for (const p of projections) {
    const draft = projectTorrent(p, ctx.did, ctx.publicUrl);
    const fingerprint = contentFingerprint(draft);
    const previous = currentBy.get(p.id);

    if (previous?.contentHash === fingerprint) {
      unchanged++;
      continue;
    }

    // An edit points back at what it replaces, which is what lets a consumer
    // order two records for the same release without trusting a clock — and
    // what makes the lineage unforgeable, since it is inside the signature.
    draft['trackarr:replaces'] = previous?.id ?? null;
    const signed = signRecord(draft, {
      privateKeyPem: ctx.privateKeyPem,
      did: ctx.did,
    });

    await db.transaction(async (tx) => {
      if (previous) {
        await tx
          .update(schema.catalogRecords)
          .set({ supersededAt: new Date() })
          .where(eq(schema.catalogRecords.id, previous.id));
      }
      await tx
        .insert(schema.catalogRecords)
        .values({
          id: signed.id,
          torrentId: p.id,
          infoHash: p.infoHash,
          issuer: ctx.did,
          kind: 'torrent',
          contentHash: fingerprint,
          body: signed as unknown as Record<string, unknown>,
          supersedes: previous?.id ?? null,
        })
        // A record already published under this address is the same record.
        // Re-minting it after a rollback must not be an error.
        .onConflictDoNothing({ target: schema.catalogRecords.id });
    });
    minted++;
  }

  return { minted, unchanged };
}

/**
 * Retire a torrent's record with a signed tombstone.
 *
 * An absence cannot be verified — only a statement can — so withdrawing a
 * release has to be something we SAY, not something a partner infers from a
 * gap. Without it a hidden torrent stays in every mirror that ever saw it.
 */
export async function mintTombstone(
  torrentId: string,
  ctx: MintContext,
): Promise<SignedRecord | null> {
  const [previous] = await db
    .select()
    .from(schema.catalogRecords)
    .where(
      and(
        eq(schema.catalogRecords.torrentId, torrentId),
        isNull(schema.catalogRecords.supersededAt),
      ),
    )
    .limit(1);
  // A record with no info hash is not about a release, so there is nothing to
  // withdraw with a tombstone. Only identity records are shaped that way, and
  // they are retired by superseding them instead.
  if (!previous || previous.kind === 'tombstone' || !previous.infoHash) {
    return null;
  }

  const draft = projectTombstone(
    previous.infoHash,
    ctx.did,
    previous.id,
    new Date(),
  );
  const signed = signRecord(draft, {
    privateKeyPem: ctx.privateKeyPem,
    did: ctx.did,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(schema.catalogRecords)
      .set({ supersededAt: new Date() })
      .where(eq(schema.catalogRecords.id, previous.id));
    await tx
      .insert(schema.catalogRecords)
      .values({
        id: signed.id,
        torrentId,
        infoHash: previous.infoHash,
        issuer: ctx.did,
        kind: 'tombstone',
        // A tombstone's lineage IS its content — there is nothing else in it —
        // so the two hashes coincide, and a second tombstone for the same
        // record is correctly recognised as the same statement.
        contentHash: contentFingerprint(draft),
        body: signed as unknown as Record<string, unknown>,
        supersedes: previous.id,
      })
      .onConflictDoNothing({ target: schema.catalogRecords.id });
  });

  return signed;
}
