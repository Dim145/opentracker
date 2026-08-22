/**
 * POST /api/federation/records — server to server.
 *
 * The records themselves, fetched by content address. Reconciliation decides
 * WHICH records a partner is missing; this hands them over. Splitting the two
 * is what lets one fetch serve a record learned from a reconciliation round,
 * from a live search, or from a relay — the id is the whole request, and where
 * it came from is not our business.
 *
 * A POST, and not for the usual reason. The ids are the request, and a few
 * hundred content addresses is fifteen kilobytes of them: past what belongs in
 * a URL, past what proxies keep, and — as this discovered the hard way — past
 * the ten-thousand-character ceiling this server's own security middleware
 * puts on a query parameter. That ceiling is right. The request was wrong.
 *
 * The `since=<seq>` feed this replaces is gone with the cursor it served. It
 * could skip a record and never notice; see `rbsr.ts`.
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
import { inArray } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';
import { countersign, relayEnabled } from '~~/utils/federation/relay';
import {
  getFederationConfig,
  getPrivateKeyPem,
} from '~~/utils/federation/config';
import { didKeyFromPublicKey } from '~~/utils/federation/did';

/**
 * How many records one request may name. A record is a few hundred bytes, so
 * this is a response of a megabyte or two — and a partner with more than this
 * to catch up on is better served by several requests than by one that times
 * out halfway.
 */
const MAX_IDS = 500;
/** 500 content addresses, generously. */
const MAX_BODY_BYTES = 128 * 1024;

export default defineEventHandler(async (event) => {
  const { rawBody } = await verifyInboundS2S(event, 'catalog', {
    post: true,
    maxBodyBytes: MAX_BODY_BYTES,
  });

  let wanted: unknown = [];
  try {
    wanted = (JSON.parse(rawBody || '{}') as { ids?: unknown })?.ids ?? [];
  } catch {
    throw createError({ statusCode: 400, message: 'Malformed body' });
  }

  const ids = [
    ...new Set(
      (Array.isArray(wanted) ? wanted : [])
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 128),
    ),
  ].slice(0, MAX_IDS);

  if (!ids.length) return { ok: true, records: [], count: 0 };

  const relaying = await relayEnabled();
  const rows = await db
    .select({
      id: schema.catalogRecords.id,
      body: schema.catalogRecords.body,
      origin: schema.catalogRecords.origin,
      hops: schema.catalogRecords.hops,
    })
    .from(schema.catalogRecords)
    .where(inArray(schema.catalogRecords.id, ids));

  // Verbatim. A record rebuilt from parts is a second implementation of the
  // format, and it eventually disagrees with the proof.
  //
  // Superseded records are served too, on purpose: a partner that asks for one
  // by id has a reason to want that generation — a lineage it is walking back,
  // or a range it reconciled before the edit landed. Withholding it would
  // answer "no such record", which is false.
  // Ours go out bare; somebody else's go out countersigned. The
  // countersignature is what says "we are handing you this one", and it is the
  // only thing that lets a partner take in a record from an instance it does
  // not federate with — the record itself is unchanged, because its address
  // covers its content and a field added in transit would rename it.
  const config = await getFederationConfig();
  const privateKeyPem = config ? getPrivateKeyPem(config) : null;
  const ourDid = config?.publicKey ? didKeyFromPublicKey(config.publicKey) : null;

  const envelopes = rows
    .filter((r) => relaying || r.origin === 'local')
    .filter((r) => r.origin === 'local' || r.hops <= 1)
    .map((r) => ({
      record: r.body,
      relay:
        r.origin === 'local' || !privateKeyPem || !ourDid
          ? null
          : countersign(r.id, ourDid, privateKeyPem),
    }));

  return { ok: true, records: envelopes, count: envelopes.length };
});
