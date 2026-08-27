/**
 * The part of this that a stranger can read.
 *
 * Everything else in federation is a signed conversation between instances
 * that agreed to know each other. This is the door for somebody who has not:
 * an actor document saying who we are and which key we sign with, and an
 * outbox listing what we publish. No handshake, no signature, no account.
 *
 * ## Why it is worth having at all
 *
 * Records already carry their own proofs, so anybody holding one can verify it
 * without asking us. What they cannot do is *find* one, or turn a
 * `did:key:z6Mk…` into anything a human recognises. The actor closes both
 * gaps: it is a stable URL that names the instance, publishes the key its
 * records are signed with, and points at the collection. That is the whole of
 * discoverability, and it is the difference between a format anybody could
 * consume and one anybody actually can.
 *
 * ## What it deliberately is not
 *
 * An inbox. This instance accepts no ActivityPub activities — no follows, no
 * deliveries, no side effects from a stranger. Federation happens over the
 * signed server-to-server surface, between peers, and opening a second way in
 * would be opening a second thing to defend. The actor advertises no inbox for
 * that reason rather than by omission.
 *
 * ## The `trackarr:` terms, and why the records were not re-cut
 *
 * A JSON-LD consumer expanding one of our records keeps the FEP-d8c8 core —
 * the infohash, the magnet, the name, the URL — and drops our own terms, which
 * are not mapped in the record's context. FEP-d8c8 provides for exactly this
 * ("additional non-FEP terms are preserved in non-expanded form"), and the
 * identity is the interoperable part: it is what lets somebody else recognise,
 * deduplicate and fetch a release.
 *
 * Mapping them would mean adding a term to every record's `@context` — and a
 * record is addressed by its content, so that is a new address for every
 * record in the catalogue and a full re-publication to every partner. The
 * vocabulary is served here as a document instead, which documents the terms
 * without re-cutting anything. If that trade ever changes, it changes once and
 * deliberately.
 */
import { eq, and, isNull, desc, count, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from './did';
import type { FederationConfig } from '@trackarr/db/schema';

export const AS2_CONTENT_TYPE =
  'application/activity+json; charset=utf-8';

/**
 * Adult-flagged releases stay out of the public collection.
 *
 * Not a filter a consumer asked for — the flag is on every record and anybody
 * reading them can apply their own rule. This is about what an unauthenticated
 * endpoint publishes by default on a private tracker: an operator turning on
 * "public catalogue" is agreeing to be discoverable, and it should take a
 * further, separate decision before that includes this. Nobody has asked for
 * the opposite, so there is no setting for it yet — when somebody does, it is
 * one boolean and this comment is where it goes.
 */
const NOT_ADULT = sql`
  coalesce(${schema.catalogRecords.body}->>'trackarr:isAdult', 'false') <> 'true'
  -- And the withdrawal of one. A tombstone carries no name and no flag of its
  -- own, only an infohash and the id it replaces — so filtering on the body
  -- alone let deleting an adult release publish its infohash to a surface
  -- that had never been shown the release. Found by running the thing rather
  -- than by reading it.
  --
  -- Which is also the coherent answer: a withdrawal for a record that was
  -- never in this collection tells a reader nothing they can act on. They
  -- would look for an id they never held.
  AND NOT EXISTS (
    SELECT 1 FROM ${schema.catalogRecords} prior
     WHERE prior.id = ${schema.catalogRecords.body}->>'trackarr:replaces'
       AND coalesce(prior.body->>'trackarr:isAdult', 'false') = 'true'
  )`;

/**
 * What the public collection is *about*: releases, and their withdrawals.
 *
 * The table holds four kinds and only two of them describe a release. The
 * other two — `identity` and `revocation` — are the member-identity channel,
 * and they were reaching this surface because the filter said `origin='local'`
 * and nothing about kind, while the mint sweep writes all four with that same
 * origin on the same pass.
 *
 * That was not a cosmetic leak. An identity record's `trackarr:subject` is the
 * SAME DID as `attributedTo` on that member's torrent records, and its
 * `trackarr:evidence` carries whole identity documents — `preferredUsername`
 * and `trackarr:instance` included. So a crawler needed one join to turn a
 * pseudonymous upload history into a name and a home instance, which is
 * precisely what the `trackarr:uploaderName` strip below exists to prevent. A
 * revocation additionally publishes key-rotation lineage.
 *
 * Member identity is a partner-to-partner matter, exchanged over the signed
 * S2S surface where the other side is known. It has no business on the door.
 */
const PUBLIC_KINDS = sql`${schema.catalogRecords.kind} in ('torrent', 'tombstone')`;

/** Records per outbox page. Large enough to be useful, small enough to serve. */
export const PAGE_SIZE = 50;

function base(config: FederationConfig): string {
  return (config.publicUrl ?? '').replace(/\/$/, '');
}

/**
 * The instance, as an ActivityStreams actor.
 *
 * `Service` rather than `Application` or `Person`: it is an automated thing
 * that publishes on behalf of a community, which is what AS2 means by the
 * word. The key is published twice on purpose — as `assertionMethod` for a
 * Data Integrity verifier, and as `publicKey` for the older fediverse
 * convention that most software still reads.
 */
export function actorDocument(config: FederationConfig): Record<string, unknown> {
  const url = base(config);
  const did = config.publicKey ? didKeyFromPublicKey(config.publicKey) : null;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/data-integrity/v2',
    ],
    type: 'Service',
    id: `${url}/api/federation/actor`,
    name: config.instanceName ?? 'Trackarr instance',
    url: url || null,
    // No inbox. Nothing here accepts activities, and advertising one we do not
    // serve would invite deliveries we would only drop.
    outbox: `${url}/api/federation/outbox`,
    'trackarr:vocabulary': `${url}/api/federation/context`,
    ...(did
      ? {
          assertionMethod: [
            {
              id: `${did}#${did.slice('did:key:'.length)}`,
              type: 'Multikey',
              controller: `${url}/api/federation/actor`,
              publicKeyMultibase: did.slice('did:key:'.length),
            },
          ],
          publicKey: {
            id: `${url}/api/federation/actor#main-key`,
            owner: `${url}/api/federation/actor`,
            publicKeyPem: config.publicKey,
          },
        }
      : {}),
  };
}

/** How many records this instance publishes, for the collection header. */
export async function outboxSize(): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(schema.catalogRecords)
    .where(
      and(
        isNull(schema.catalogRecords.supersededAt),
        // Ours. The outbox is what this instance said, not what it carries for
        // others — a relayed record belongs in its author's outbox, and
        // claiming it here would be attributing somebody else's work to us.
        eq(schema.catalogRecords.origin, 'local'),
        PUBLIC_KINDS,
        NOT_ADULT,
      ),
    );
  return Number(row?.n ?? 0);
}

/** One page of published records, newest first. */
export async function outboxPage(
  page: number,
): Promise<Array<Record<string, unknown>>> {
  const rows = await db
    .select({ body: schema.catalogRecords.body })
    .from(schema.catalogRecords)
    .where(
      and(
        isNull(schema.catalogRecords.supersededAt),
        eq(schema.catalogRecords.origin, 'local'),
        PUBLIC_KINDS,
        NOT_ADULT,
      ),
    )
    .orderBy(desc(schema.catalogRecords.createdAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  // The uploader's display name is stripped on this — the ONE unauthenticated
  // surface. Partners reach records through signed S2S (`records.post`) and get
  // them verbatim and proof-verifiable; the public outbox is discovery, and on
  // a private tracker it must not hand a crawler a member's name tied to their
  // whole upload history. The actor (`attributedTo`, a DID) still identifies
  // the uploader for anyone entitled to resolve it. Dropping one `trackarr:`
  // field means a public-outbox item is not proof-verifiable — deliberately, on
  // this surface only.
  return rows.map((r) => {
    const body = r.body as Record<string, unknown>;
    if (body['trackarr:uploaderName'] == null) return body;
    const { ['trackarr:uploaderName']: _omit, ...rest } = body;
    return rest;
  });
}

/**
 * The `trackarr:` vocabulary, as a JSON-LD context document.
 *
 * Served so the terms are documented and resolvable, not because records point
 * at it — see the note at the top of this file for why they do not.
 */
export function contextDocument(config: FederationConfig): Record<string, unknown> {
  const ns = `${base(config)}/api/federation/context#`;
  const term = (name: string) => `${ns}${name}`;

  return {
    '@context': {
      trackarr: ns,
      size: { '@id': term('size'), '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
      contentSignature: term('contentSignature'),
      category: term('category'),
      categoryType: term('categoryType'),
      isAdult: { '@id': term('isAdult'), '@type': 'http://www.w3.org/2001/XMLSchema#boolean' },
      tags: { '@id': term('tags'), '@container': '@set' },
      imdbId: term('imdbId'),
      tmdbId: term('tmdbId'),
      tvdbId: term('tvdbId'),
      igdbId: term('igdbId'),
      openlibraryId: term('openlibraryId'),
      season: { '@id': term('season'), '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
      episode: { '@id': term('episode'), '@type': 'http://www.w3.org/2001/XMLSchema#integer' },
      uploaderName: term('uploaderName'),
      issuer: { '@id': term('issuer'), '@type': '@id' },
      replaces: { '@id': term('replaces'), '@type': '@id' },
      subject: { '@id': term('subject'), '@type': '@id' },
      evidence: { '@id': term('evidence'), '@container': '@set' },
      endorsement: term('endorsement'),
      succeededBy: { '@id': term('succeededBy'), '@type': '@id' },
    },
  };
}

/**
 * The two collection shapes, built rather than typed out in the handler.
 *
 * They look trivial and they are the part a stranger's software actually
 * parses. Getting `partOf` wrong, or emitting `next` on the last page, or
 * `first` on an empty collection, produces a document that reads fine to a
 * human and walks forever — or stops after one page — for a consumer. Those
 * are exactly the mistakes a test catches and a manual pass does not, and
 * until now nothing in this repository asserted any of them.
 */
const AS2_CONTEXT = 'https://www.w3.org/ns/activitystreams';

/** The header: how many, and where to start. */
export function collectionHeader(
  id: string,
  total: number,
): Record<string, unknown> {
  return {
    '@context': AS2_CONTEXT,
    type: 'OrderedCollection',
    id,
    totalItems: total,
    // No `first` on an empty collection. Advertising a page that would come
    // back empty invites a consumer to walk a collection that has nothing to
    // walk, and a link to nothing is worse than no link.
    ...(total ? { first: `${id}?page=1` } : {}),
  };
}

/** One page, with only the neighbours that exist. */
export function collectionPage(
  id: string,
  page: number,
  total: number,
  items: unknown[],
): Record<string, unknown> {
  return {
    '@context': AS2_CONTEXT,
    type: 'OrderedCollectionPage',
    id: `${id}?page=${page}`,
    partOf: id,
    totalItems: total,
    orderedItems: items,
    // `next` only while there is one. A page that always links onward is a
    // collection a well-behaved consumer never finishes reading.
    ...(page * PAGE_SIZE < total ? { next: `${id}?page=${page + 1}` } : {}),
    ...(page > 1 ? { prev: `${id}?page=${page - 1}` } : {}),
  };
}
