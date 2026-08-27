/**
 * The two decisions `POST /api/federation/records` makes, taken out of the
 * handler so they can be examined.
 *
 * Both were previously inline: a `.filter().filter().map()` chain and a body
 * parse, sitting inside a `defineEventHandler` that needs a signed request, a
 * database and an h3 event to run at all. That is not a testable shape, and
 * the result was that the sharpest rule in this whole step — an instance must
 * never hand on a record that was already relayed to it — lived in a
 * subexpression nothing asserted, verified only by my own passes over a live
 * mesh. A rule proven by hand is a rule that survives until somebody edits the
 * line.
 *
 * Nothing here touches the database, the network or the clock. Given rows and
 * a signer, it decides; the handler fetches and returns.
 */

// The wire shape belongs to `relay.ts`, which defines what a countersignature
// is; declaring a second `Envelope` here would have given Nitro's auto-import
// two candidates for one name and let it pick. Type-only, so nothing of the
// relay module's runtime — or its database — is dragged in.
import type { Envelope } from './relay';
import type { DataIntegrityProof } from './record';

/** How many records one request may name. */
export const MAX_IDS = 500;

/** Longest plausible content address, with room to spare. */
const MAX_ID_LENGTH = 128;

/** What the store gives us about a record, for the purposes of serving it. */
export interface ServableRow {
  id: string;
  body: unknown;
  origin: string;
  hops: number;
}

/** The instance's signing identity, or nothing if it has none yet. */
export interface Signer {
  did: string;
  /**
   * Both forms of the vouching, for one record.
   *
   * `relay` is the bare statement every partner already rebuilds; `audience` is
   * the same statement naming the recipient, which is what makes the vouch
   * non-transferable. `audience` is null when we do not know the recipient's
   * `instanceId` — a peer we have not handshaked with — because a binding to
   * nobody is worse than none: it would verify at no partner at all.
   */
  countersign: (recordId: string) => {
    relay: DataIntegrityProof;
    audience: DataIntegrityProof | null;
  };
}

/**
 * The ids a request actually asks for.
 *
 * Deduplicated, trimmed, bounded and capped — a partner drives this list, so
 * its length is our work. Anything that is not a plausible id is dropped
 * rather than refused: a request naming four hundred good ids and one number
 * should serve the four hundred.
 */
export function wantedIds(raw: unknown): string[] {
  const list = Array.isArray((raw as { ids?: unknown } | null)?.ids)
    ? ((raw as { ids: unknown[] }).ids)
    : [];
  return [
    ...new Set(
      list
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= MAX_ID_LENGTH),
    ),
  ].slice(0, MAX_IDS);
}

/**
 * What we are willing to hand over, and under whose name.
 *
 * Three rules, in order:
 *
 * - Ours always goes out. Publishing was decided when the record was minted.
 * - Somebody else's goes out only while relaying is on. An instance with
 *   relaying off carries records for its own catalogue, not for the network.
 * - Somebody else's goes out only at first hand. This is where the two-hop
 *   bound is enforced — not by trusting a partner's account of how far a
 *   record has travelled, but by refusing to extend a chain we did not start.
 *
 * Then the signature. Ours go out bare; somebody else's carry a
 * countersignature, which is the thing that says "we are handing you this
 * one" and the only thing that lets the receiver take in a record from an
 * instance it does not federate with. The record itself is never touched — its
 * address covers its content, so a field added in transit would rename it.
 *
 * Two countersignatures, not one: see `Signer.countersign`. The pair is what
 * lets the audience binding ship without a flag day for correctness.
 */
export function envelopesFor(
  rows: ServableRow[],
  opts: { relaying: boolean; signer: Signer | null },
): Envelope[] {
  return rows
    .filter((r) => {
      if (r.origin === 'local') return true;
      return opts.relaying && r.hops <= 1;
    })
    .map((r) => {
      if (r.origin === 'local' || !opts.signer) {
        return { record: r.body, relay: null };
      }
      const { relay, audience } = opts.signer.countersign(r.id);
      // Both go out. The bare one keeps a partner on an older build working;
      // the bound one is what a current partner prefers and what
      // `FEDERATION_REQUIRE_AUDIENCE` will one day require. Emitting only the
      // bound one would break relaying toward every partner that rebuilds the
      // statement without it — which is why this is additive rather than a
      // change to the field that already exists.
      return { record: r.body, relay, relayAudience: audience };
    });
}
