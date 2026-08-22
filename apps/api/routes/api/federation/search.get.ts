/**
 * GET /api/federation/search?q=<query>&limit=<n>  — inbound, S2S.
 *
 * Live federated search: a partner queries our catalogue in real time. It
 * answers with **the same signed records** a partner reconciles over,
 * not with a hand-shaped result object.
 *
 * That is the whole change here. The old handler projected columns into a
 * bespoke JSON shape, which made live search a second definition of "what a
 * federated release is" — one that had to be kept in step with the catalogue
 * feed by hand, and that a partner could only take on trust. Returning records
 * means a searching partner verifies these results exactly like any other, and
 * ingests them through the same path. Search becomes a way of *finding*
 * records early, never a different kind of answer.
 *
 * `superseded_at IS NULL` is the only exposure rule, and it is not a rule this
 * handler invents: what this instance is willing to publish was decided when
 * the record was minted. The join onto `torrents` is a search index over
 * records we already published, nothing more — it narrows which of them to
 * return, it cannot widen it.
 *
 * Signature covers the full request path (incl. query); GET has no body so the
 * digest is over the empty string.
 */
import { eq, and, or, ilike, desc, isNull } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';
import { escapeLike } from '~~/utils/sql';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 25;

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  const search = typeof q.q === 'string' ? q.q.trim() : '';
  if (search.length < 2) {
    throw createError({ statusCode: 400, message: 'query too short' });
  }
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const esc = `%${escapeLike(search)}%`;
  const rows = await db
    .select({ body: schema.catalogRecords.body })
    .from(schema.catalogRecords)
    .innerJoin(
      schema.torrents,
      eq(schema.catalogRecords.torrentId, schema.torrents.id),
    )
    .where(
      and(
        eq(schema.catalogRecords.kind, 'torrent'),
        isNull(schema.catalogRecords.supersededAt),
        // Live search answers about OUR catalogue. Relayed records reach a
        // partner through reconciliation, where they arrive countersigned;
        // handing one over here would be vouching for it without saying so.
        eq(schema.catalogRecords.origin, 'local'),
        or(
          ilike(schema.torrents.name, esc),
          eq(schema.catalogRecords.infoHash, search.toLowerCase()),
        ),
      ),
    )
    .orderBy(desc(schema.catalogRecords.createdAt))
    .limit(limit);

  // Verbatim, like the record feed: a record rebuilt from parts is a second
  // implementation of the format, and it eventually disagrees with the proof.
  const records = rows.map((r) => ({ record: r.body, relay: null }));
  return { ok: true, records, count: records.length };
});
