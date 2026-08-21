/**
 * GET /api/federation/records?since=<seq>&limit=<n> — server to server.
 *
 * The catalogue as signed records. This replaces the three feeds a partner
 * used to poll — `catalog` for new rows, `catalog-refresh` for edits,
 * `catalog-removals` for deletions — because with immutable records all three
 * are the same thing: an edit is a record that supersedes another, a
 * withdrawal is a `Tombstone`, and both arrive in the same stream.
 *
 * The handler is transport and nothing else, deliberately. What this instance
 * is willing to publish was decided when the record was minted and is enforced
 * by the record's existence, not by a `WHERE` clause here — a feed filter can
 * stop sending something, it cannot un-send it.
 *
 * Consequence worth stating: a partner does not have to trust this endpoint.
 * Every record carries its own proof, so a hostile or compromised server can
 * withhold records or replay old ones — it cannot forge one.
 */
import {
  listRecordsSince,
  type RecordPage,
} from '~~/utils/federation/catalogRecord';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'catalog');

  const q = getQuery(event);
  const since = Math.max(0, parseInt(String(q.since ?? '0'), 10) || 0);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(String(q.limit ?? DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
  );

  const page: RecordPage = await listRecordsSince(since, limit);
  return { ok: true, ...page, count: page.records.length };
});
