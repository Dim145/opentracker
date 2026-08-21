/**
 * Range-based set reconciliation.
 *
 * Two instances hold sets of records and want to agree on them. Until now that
 * was done with a watermark: "give me everything with a sequence number above
 * the last one I saw". A watermark answers a different question than the one
 * being asked, and the gap between the two is where the failures live:
 *
 * - **It can skip.** A sequence is assigned at INSERT and two concurrent
 *   inserts can commit out of order, so a reader paging strictly past its
 *   highest seen value can step over a record assigned earlier and committed
 *   later. The mitigation was to refuse to serve anything younger than five
 *   seconds — a heuristic, not a guarantee, and one this replaces outright
 *   because reconciliation makes no ordering assumption at all.
 * - **It cannot notice drift.** Once a record is missed, nothing looks back.
 *   The catalogues diverge silently and stay diverged.
 * - **An absence says nothing.** "This is gone" has to travel as its own
 *   message, because a forward-only cursor cannot tell "removed" from "not
 *   reached yet".
 * - **It does not survive relaying.** A sequence number is local to whoever
 *   issued it. Once B can hand over records C published, a per-peer watermark
 *   is meaningless: one record arrives with two unrelated positions.
 *
 * Reconciliation asks the question directly — *which of these do you not
 * have?* — and answers it in O(log n) round trips without either side knowing
 * anything about the other's state to begin with. This is Negentropy's
 * algorithm (Range-Based Set Reconciliation), which Nostr relays run in
 * production.
 *
 * ## How it works
 *
 * Both sides sort their records by id and treat the id space as an interval.
 * One side sends ranges, each carrying a fingerprint of the ids it holds
 * inside. The other fingerprints the same interval over its own ids:
 *
 * - fingerprints match → that interval agrees, and neither side ever looks at
 *   it again, however many records it holds;
 * - they differ and one side is small → it sends the ids outright, and the
 *   difference for that interval is then known exactly;
 * - they differ and both are large → it cuts the interval up and sends one
 *   fingerprint per piece.
 *
 * Each round divides the disagreeing intervals, so agreement is reached in a
 * number of rounds logarithmic in the set size, and the bytes on the wire are
 * proportional to the DIFFERENCE rather than to the catalogue.
 *
 * ## Sorted by id alone, not by (timestamp, id)
 *
 * Negentropy orders by timestamp then id, because Nostr queries are
 * time-bounded and time makes its ranges meaningful. Here the ids are content
 * addresses — uniformly distributed hashes, which cut into even buckets for
 * free — and, more to the point, the id is the ONE thing both sides are
 * guaranteed to agree on. A sort key derived from the record body would work
 * only for as long as both sides derived it identically, forever, and the
 * failure if they ever stopped would be two sides converging confidently on
 * nonsense. The cost is that a range cannot mean "the last month", which
 * nothing here needs.
 *
 * ## JSON, not the binary framing
 *
 * The algorithm is Negentropy's; the encoding is not. Every other message in
 * this server-to-server layer is JSON, and a hex-encoded binary side-channel
 * would be one more thing to decode by hand when a sync misbehaves. Nothing
 * depends on the framing — swapping in the varint wire format later is an
 * encoding change, not a redesign — and there is no concrete interop to be had
 * from it, since our records are not Nostr events.
 *
 * ## The fingerprint is defined here, not by whoever computes it
 *
 * It is a hash of the ids joined by newlines, then `|`, then the count:
 * `sha256("a\nb|2")`, first 32 hex characters. Written out because BOTH SIDES
 * MUST AGREE ON IT EXACTLY and one of them computes it in SQL — a store that
 * fingerprints a range its own way is a store that reconciles to a confident
 * wrong answer. The count is in the input so that a peer repeating itself
 * cannot pass for a set that does not.
 *
 * Negentropy XORs the ids instead, which makes fingerprints incrementally
 * maintainable — worth a lot when the set is in memory, nothing when it is an
 * index scan away. Hashing the ordered join is also strictly stronger: an XOR
 * is malleable under reordering and cancellation.
 */
import { createHash } from 'node:crypto';

/** The bottom of the id space. Sorts below every hex digest. */
export const MIN_BOUND = '';

/**
 * One interval of the id space, `[lo, hi)`. `hi === null` is +infinity.
 *
 * `skip` means the two sides agreed here. `ids` is a terminal answer — the
 * exact contents, so the receiver can compute the difference itself. `fp` is
 * an invitation to look closer.
 */
export type Range =
  | { lo: string; hi: string | null; mode: 'skip' }
  | { lo: string; hi: string | null; mode: 'fp'; fp: string; n: number }
  | { lo: string; hi: string | null; mode: 'ids'; ids: string[] };

/**
 * Below this many ids on either side, an interval is settled by sending the
 * ids rather than by splitting again. Cutting a twelve-item range costs
 * another round trip to save a few hundred bytes.
 */
export const IDS_THRESHOLD = 24;

/** Most ids one side will hand over for a single interval. */
export const MAX_IDS_PER_RANGE = 2_000;

/** How many pieces a disagreeing interval is cut into. */
export const BUCKETS = 16;

/**
 * Caps on what one message can make us do. A partner drives this loop, so
 * every one of these is a bound on the work it can ask for; all are far above
 * what a real catalogue reaches.
 */
export const MAX_RANGES_PER_MESSAGE = 512;
export const MAX_ROUNDS = 12;

/** The fingerprint of an ascending list of ids. See the header. */
export function fingerprint(ids: string[]): string {
  return createHash('sha256')
    .update(`${ids.join('\n')}|${ids.length}`)
    .digest('hex')
    .slice(0, 32);
}

/** A piece of the id space, summarised. */
export interface Bucket {
  lo: string;
  hi: string | null;
  fp: string;
  n: number;
}

/**
 * Everything one side can be asked about its own set.
 *
 * Deliberately not "give me your ids": a range can hold more records than fit
 * in memory, so summarising has to be something the store can do without
 * materialising the range. Postgres does it in one index scan.
 */
export interface SetSource {
  /** Fingerprint and count of `[lo, hi)`. */
  summary(lo: string, hi: string | null): Promise<{ fp: string; n: number }>;
  /** Ascending ids in `[lo, hi)`, at most `limit`. Only called when small. */
  ids(lo: string, hi: string | null, limit: number): Promise<string[]>;
  /**
   * Cut `[lo, hi)` into at most `buckets` pieces along our own ids, each
   * summarised. The bounds are real ids, so the other side can name the same
   * intervals without having been told anything — and it may hold a wholly
   * different number of items inside each one, which is the point.
   */
  buckets(
    lo: string,
    hi: string | null,
    buckets: number,
  ): Promise<Bucket[]>;
}

/** What one side learned, and what it wants to ask next. */
export interface ReconcileStep {
  /** Ranges to send back. Empty means this side has nothing more to ask. */
  reply: Range[];
  /** Ids the OTHER side holds that we do not. */
  missing: string[];
  /**
   * Ids WE hold that the other side does not — but only inside intervals
   * whose contents we saw in full. Never inferred from a fingerprint, so a
   * reconciliation that fails halfway can be acted on safely.
   */
  extra: string[];
}

export interface RespondOptions {
  /**
   * Answer an exact list with our own exact list.
   *
   * The responder does; the initiator does not, or the two would hand each
   * other lists forever. It is the one place the protocol is not symmetric,
   * and it is what makes a range terminal.
   */
  echoIds: boolean;
}

/**
 * Answer one message.
 *
 * Never throws on a hostile one. A range that is malformed, inverted or
 * oversized is dropped: losing an interval costs a slower convergence, while
 * throwing would let a partner end our sync by sending a single bad range.
 */
export async function respond(
  incoming: unknown,
  mine: SetSource,
  opts: RespondOptions,
): Promise<ReconcileStep> {
  const reply: Range[] = [];
  const missing: string[] = [];
  const extra: string[] = [];

  const list = Array.isArray(incoming) ? incoming : [];
  for (const raw of list.slice(0, MAX_RANGES_PER_MESSAGE)) {
    const r = raw as Range;
    if (!r || typeof r !== 'object') continue;
    if (typeof r.lo !== 'string') continue;
    if (r.hi !== null && typeof r.hi !== 'string') continue;
    if (r.hi !== null && r.hi <= r.lo) continue; // inverted or empty
    if (r.mode === 'skip') continue;

    if (r.mode === 'ids') {
      if (!Array.isArray(r.ids) || r.ids.length > MAX_IDS_PER_RANGE) continue;
      const theirs = r.ids.filter((x): x is string => typeof x === 'string');
      const ours = await mine.summary(r.lo, r.hi);
      if (ours.n > MAX_IDS_PER_RANGE) {
        // They can name their side exactly and we cannot name ours. Narrow it
        // first rather than truncate: a short list here would read as "that is
        // all I have", and the missing records would never be asked for again.
        for (const b of await mine.buckets(r.lo, r.hi, BUCKETS)) {
          reply.push({ lo: b.lo, hi: b.hi, mode: 'fp', fp: b.fp, n: b.n });
        }
        continue;
      }
      const ourIds = await mine.ids(r.lo, r.hi, MAX_IDS_PER_RANGE);
      const ourSet = new Set(ourIds);
      const theirSet = new Set(theirs);
      for (const id of theirSet) if (!ourSet.has(id)) missing.push(id);
      for (const id of ourIds) if (!theirSet.has(id)) extra.push(id);
      if (opts.echoIds) {
        reply.push({ lo: r.lo, hi: r.hi, mode: 'ids', ids: ourIds });
      }
      continue;
    }

    if (r.mode !== 'fp' || typeof r.fp !== 'string') continue;
    const theirCount = Number.isFinite(r.n) ? Math.max(0, Math.trunc(r.n)) : 0;

    const ours = await mine.summary(r.lo, r.hi);
    if (ours.fp === r.fp) {
      reply.push({ lo: r.lo, hi: r.hi, mode: 'skip' });
      continue;
    }
    // They disagree. Either side being small enough to name outright ends the
    // interval in one more message; otherwise cut it up.
    if (Math.min(ours.n, theirCount) <= IDS_THRESHOLD && ours.n <= MAX_IDS_PER_RANGE) {
      reply.push({
        lo: r.lo,
        hi: r.hi,
        mode: 'ids',
        ids: await mine.ids(r.lo, r.hi, MAX_IDS_PER_RANGE),
      });
      continue;
    }
    for (const b of await mine.buckets(r.lo, r.hi, BUCKETS)) {
      reply.push({ lo: b.lo, hi: b.hi, mode: 'fp', fp: b.fp, n: b.n });
    }
  }

  return { reply: reply.slice(0, MAX_RANGES_PER_MESSAGE), missing, extra };
}

/**
 * The opening message: one fingerprint over everything.
 *
 * In the steady state — nothing changed since last time — this is the whole
 * conversation. One request, one `skip`, no ids on the wire, and both sides
 * have PROVEN they agree rather than assumed it. That is the case a watermark
 * was cheap for; this is barely dearer, and every other case is the one the
 * watermark got wrong.
 */
export async function opening(mine: SetSource): Promise<Range[]> {
  const all = await mine.summary(MIN_BOUND, null);
  if (all.n <= IDS_THRESHOLD) {
    return [
      {
        lo: MIN_BOUND,
        hi: null,
        mode: 'ids',
        ids: await mine.ids(MIN_BOUND, null, MAX_IDS_PER_RANGE),
      },
    ];
  }
  return [{ lo: MIN_BOUND, hi: null, mode: 'fp', fp: all.fp, n: all.n }];
}

/**
 * A `SetSource` over a plain array. The reference the SQL one has to match:
 * every property the protocol relies on is provably true here, so a
 * disagreement between the two is a bug in the SQL and not in the algorithm.
 */
export function arraySource(input: readonly string[]): SetSource {
  const all = [...new Set(input)].sort();
  const within = (lo: string, hi: string | null) =>
    all.filter((id) => id >= lo && (hi === null || id < hi));

  return {
    async summary(lo, hi) {
      const ids = within(lo, hi);
      return { fp: fingerprint(ids), n: ids.length };
    },
    async ids(lo, hi, limit) {
      return within(lo, hi).slice(0, limit);
    },
    async buckets(lo, hi, count) {
      const ids = within(lo, hi);
      if (!ids.length) return [];
      const per = Math.ceil(ids.length / count);
      const out: Bucket[] = [];
      for (let i = 0; i < ids.length; i += per) {
        const chunk = ids.slice(i, i + per);
        const last = i + per >= ids.length;
        out.push({
          lo: i === 0 ? lo : ids[i]!,
          hi: last ? hi : ids[i + per]!,
          fp: fingerprint(chunk),
          n: chunk.length,
        });
      }
      return out;
    },
  };
}
