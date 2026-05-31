/**
 * Peer lifecycle — the single source of truth for legal status transitions.
 *
 * The status machine (`pending_out`, `pending_in`, `active`, `suspended`,
 * `blocked`, `revoked`) was previously enforced by ad-hoc `if (status !== X)`
 * guards scattered across handshake / callback / approve / patch, each
 * encoding its own slice of the rules — so they could (and did) drift. This
 * centralises the transitions a given trigger may perform.
 */
export type PeerStatus =
  | 'pending_out'
  | 'pending_in'
  | 'active'
  | 'suspended'
  | 'blocked'
  | 'revoked';

/** Statuses that represent an ESTABLISHED link (handshake already completed). */
export const ESTABLISHED_STATUSES: PeerStatus[] = [
  'active',
  'suspended',
  'blocked',
];

/**
 * Owner governance (PATCH) transitions. `revoked` is terminal (delete the row
 * to start over); pending_* must be approved/deleted, not patched. This
 * notably forbids resurrecting a `revoked` peer straight to `active`.
 */
const GOVERNANCE_TRANSITIONS: Record<PeerStatus, PeerStatus[]> = {
  active: ['suspended', 'blocked', 'revoked'],
  suspended: ['active', 'blocked', 'revoked'],
  blocked: ['suspended', 'revoked'],
  revoked: [],
  pending_out: [],
  pending_in: [],
};

/** Can the owner move a peer from `from` to `to` via the governance PATCH? */
export function canGovernanceTransition(
  from: string,
  to: PeerStatus,
): boolean {
  return (GOVERNANCE_TRANSITIONS[from as PeerStatus] ?? []).includes(to);
}

/**
 * Result of evaluating an inbound `callback` against the current status:
 *  - 'complete' → genuine pending_out → flip to active (apply scopes)
 *  - 'idempotent' → already active → ACK without touching scopes
 *  - 'reject' → no outbound handshake awaiting confirmation (409)
 */
export function evaluateCallback(
  status: string,
): 'complete' | 'idempotent' | 'reject' {
  if (status === 'active') return 'idempotent';
  if (status === 'pending_out') return 'complete';
  return 'reject';
}
