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
 * count per range, the number of ranges open at an end, the aggregate queries
 * and the body size are all capped, duplicate ranges are answered once, and a
 * malformed range is dropped rather than thrown on. Losing an interval costs a
 * slower convergence; throwing would let one bad range end the sync.
 *
 * The last bound is per-minute rather than per-message — see
 * `WIDE_RANGES_PER_MINUTE`. Everything else limits what ONE message costs; that
 * limits how much of the expensive kind a partner may ask for over time, which
 * is the other half of the same product.
 */
import { verifyInboundS2S } from '~~/utils/federation/inbound';
import { publishedSet } from '~~/utils/federation/recordSet';
import { relayEnabled } from '~~/utils/federation/relay';
import {
  MAX_WIDE_RANGES_PER_MESSAGE,
  respond,
} from '~~/utils/federation/rbsr';
import { redis } from '~~/redis/client';

/**
 * A message is a few hundred ranges at most, each a couple of bounds and a
 * fingerprint; an id list caps at 2 000 short strings. 512 KB is far above
 * that and far below anything worth buffering by accident.
 */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Aggregates over most of the record set one partner may cause per minute.
 *
 * A budget on the WORK, not on the requests, and that distinction is the whole
 * design. Measured on Postgres 18 over 200 000 published records: a range open
 * at an end costs 115-145 ms (`summary`) and, when the two sides disagree, a
 * further 300-465 ms (`buckets`). Everything else a message asks for is an
 * index range scan over a handful of rows. So the cost of a message is very
 * nearly the number of open-ended ranges in it, and nothing else.
 *
 * A request-count limit would have been the obvious lever and the wrong one: a
 * normal sync sends almost entirely narrow ranges, so the limit would have
 * throttled partners for messages that cost nothing — and a 429 lands on the
 * peer's dashboard as `lastError`, which is an alarm about our own accounting.
 * Billing the expensive thing instead means a legitimate partner never meets
 * this at all.
 *
 * 120/min against a measured need of 24 per sync tick (two per message, twelve
 * rounds) — five times the most aggressive interval anyone would configure. It
 * caps a hostile partner at about one core of Postgres, down from thirteen
 * before the per-message cap and this together.
 *
 * Fixed one-minute buckets rather than a sliding window: this is a throttle on
 * cost, not a security boundary, and the failure mode of the seam between two
 * buckets is one extra allowance — not a bypass.
 */
const WIDE_RANGES_PER_MINUTE = 120;

/**
 * Reserve up to `want` of this peer's allowance, and return what it got.
 *
 * Reserve-then-refund rather than read-then-write, so two requests arriving
 * together cannot both see the same remaining budget and both spend it.
 */
async function reserveWideBudget(peerId: string, want: number): Promise<number> {
  const key = `fedrec:wide:${peerId}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const after = await redis.incrby(key, want);
    await redis.expire(key, 120);
    const before = after - want;
    const granted = Math.max(0, Math.min(want, WIDE_RANGES_PER_MINUTE - before));
    if (granted < want) await redis.decrby(key, want - granted);
    return granted;
  } catch {
    // Redis unavailable. Answer the message under the per-message cap rather
    // than refusing it: the throttle is a cost control, and losing it is not a
    // reason to stop reconciling with every partner.
    return want;
  }
}

/** Give back an allowance the message turned out not to need. */
async function refundWideBudget(peerId: string, amount: number): Promise<void> {
  const key = `fedrec:wide:${peerId}:${Math.floor(Date.now() / 60_000)}`;
  try {
    await redis.decrby(key, amount);
  } catch {
    /* the bucket expires in a minute either way */
  }
}

export default defineEventHandler(async (event) => {
  const { peer, rawBody } = await verifyInboundS2S(event, 'catalog', {
    post: true,
    maxBodyBytes: MAX_BODY_BYTES,
  });

  // Keyed on the peer row rather than on the instanceId: `verifyInboundS2S` has
  // already authenticated the sender, and the peer id is the thing an operator
  // can see, suspend and block. Read after the signature check, so an
  // unauthenticated caller cannot spend a partner's allowance for it.
  const maxWideRanges = await reserveWideBudget(peer.id, MAX_WIDE_RANGES_PER_MESSAGE);

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
    maxWideRanges,
  });

  // Refund what the message did not spend. The reply-size and query budgets can
  // end the loop before every open-ended range is reached, and charging a
  // partner for work we chose not to do would throttle it for our truncation.
  if (step.wideUsed < maxWideRanges) {
    await refundWideBudget(peer.id, maxWideRanges - step.wideUsed);
  }

  // `pending` carries back the ranges the reply had no room for. The initiator
  // re-sends them, so a large first sync converges over several rounds instead
  // of losing 87% of the id space to a `.slice` — silently — every tick.
  return {
    ok: true,
    ranges: step.reply,
    pending: step.pending,
  };
});
