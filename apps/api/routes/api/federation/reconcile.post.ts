/**
 * POST /api/federation/reconcile — server to server.
 *
 * One step of range-based set reconciliation over the records this instance
 * publishes. The partner sends ranges of the id space with a fingerprint of
 * what it holds in each; this answers with `skip` where the two agree, an
 * exact list where the interval is small, and a finer set of fingerprints
 * where it is not. A few of these and both sides know exactly which records
 * the other is missing, having transferred an amount of data proportional to
 * the difference rather than to the catalogue.
 *
 * This replaces the `since`-cursor feed. The cursor could skip a record, could
 * never notice that it had, could not express a withdrawal without a separate
 * message, and would have been meaningless once records start being relayed.
 * See `rbsr.ts` for why each of those follows from what a watermark is.
 *
 * Stateless, deliberately. Every request carries the whole of the partner's
 * side of the conversation, so nothing is remembered between rounds and a
 * partner that disappears mid-reconciliation costs nothing to clean up. It
 * also means a round can be retried, reordered or replayed without corrupting
 * anything — the answer depends only on the question and on what we hold.
 *
 * A partner drives this loop, so it drives our work: the range count, the id
 * count per range and the body size are all capped, and a malformed range is
 * dropped rather than thrown on. Losing an interval costs a slower
 * convergence; throwing would let one bad range end the sync.
 */
import { verifyInboundS2S } from '~~/utils/federation/inbound';
import { publishedSet } from '~~/utils/federation/recordSet';
import { relayEnabled } from '~~/utils/federation/relay';
import { MAX_RANGES_PER_MESSAGE, respond } from '~~/utils/federation/rbsr';

/**
 * A message is a few hundred ranges at most, each a couple of bounds and a
 * fingerprint; an id list caps at 2 000 short strings. 512 KB is far above
 * that and far below anything worth buffering by accident.
 */
const MAX_BODY_BYTES = 512 * 1024;

export default defineEventHandler(async (event) => {
  const { rawBody } = await verifyInboundS2S(event, 'catalog', {
    post: true,
    maxBodyBytes: MAX_BODY_BYTES,
  });

  let ranges: unknown = [];
  try {
    const parsed = rawBody ? JSON.parse(rawBody) : {};
    ranges = (parsed as { ranges?: unknown })?.ranges ?? [];
  } catch {
    throw createError({ statusCode: 400, message: 'Malformed body' });
  }

  // `echoIds: true` — the responder answers an exact list with its own exact
  // list, which is what makes an interval terminal. The initiator does not,
  // or the two would hand each other lists forever.
  const step = await respond(ranges, publishedSet(await relayEnabled()), {
    echoIds: true,
  });

  return {
    ok: true,
    ranges: step.reply.slice(0, MAX_RANGES_PER_MESSAGE),
  };
});
