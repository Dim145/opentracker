/**
 * Inter-instance credit model — the settlement layer a webseed relay (M4) needs
 * before it can move bytes without breaking ratio.
 *
 * The problem it solves: when one instance serves another's members, the serving
 * side spends bandwidth and the served member gets it "for free" against their
 * local ratio. Left there, a partner is a ratio sink. The fix is an exchange of
 * **signed contribution attestations**: the instance that WAS served signs "your
 * member (DID) contributed N bytes", and the member's own instance verifies that
 * signature and credits their bonus upload. Ratio stays honest across the mesh,
 * and no instance has to trust another's raw numbers — only its signature over
 * them, and only up to a cap the operator sets.
 *
 * This module is the primitive, not the data source. `issueContribution` is the
 * seam M4's accounting calls with real bytes; `applyContributionAttestation` is
 * the inbound half, and is complete and testable on its own: sign an attestation
 * with a peer's key, feed it in, and a local member is credited exactly once,
 * within the daily cap.
 *
 * ## Safety
 * - Off by default (`federation_credit_enabled`): trusting a partner's word about
 *   what its users pulled is the operator's decision.
 * - Signature-bound: the attestation must be signed by the sending peer's key.
 * - Idempotent: the ledger row id IS the attestation's content address, so a
 *   replay credits nothing.
 * - Capped: bytes credited to one member per rolling day are clamped, under a row
 *   lock so concurrent attestations cannot race past the ceiling.
 * - Credits `bonus_uploaded`, never real `uploaded`: it moves ratio without ever
 *   claiming the member seeded on THIS tracker.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  CONTEXT,
  signRecord,
  verifyRecord,
  type SignedRecord,
  type UnsignedRecord,
} from './record';
import { didKeyFromPublicKey } from './did';
import {
  getFederationConfig,
  getPrivateKeyPem,
  isFederationLive,
} from './config';
import { signedPost } from './signing';
import { getSetting, SETTINGS_KEYS } from '../settings';

export const CONTRIBUTION_TYPE = 'trackarr:ContributionAttestation';

/** A single attestation credits at most this, whatever it claims — a floor of
 *  sanity under the per-member daily cap. */
const MAX_BYTES_PER_ATTESTATION = 5 * 1024 ** 4; // 5 TiB
const DEFAULT_DAILY_CAP_BYTES = 50 * 1024 ** 3; // 50 GiB

export type CreditReason = 'webseed' | 'cross-seed' | 'other';

export async function getCreditEnabled(): Promise<boolean> {
  return (await getSetting(SETTINGS_KEYS.FEDERATION_CREDIT_ENABLED)) === 'true';
}

export async function getCreditDailyCapBytes(): Promise<number> {
  const raw = await getSetting(SETTINGS_KEYS.FEDERATION_CREDIT_DAILY_CAP_BYTES);
  const n = raw ? Number(raw) : NaN;
  return Number.isSafeInteger(n) && n >= 0 ? n : DEFAULT_DAILY_CAP_BYTES;
}

/**
 * The attestation document. `published` is the period end, not "now", so the same
 * logical settlement always addresses to the same id (idempotent by construction).
 */
export function projectContributionAttestation(input: {
  subjectDid: string;
  bytes: number;
  reason: CreditReason;
  periodStart: Date;
  periodEnd: Date;
  issuerDid: string;
}): UnsignedRecord {
  return {
    '@context': CONTEXT,
    type: CONTRIBUTION_TYPE,
    'trackarr:subject': input.subjectDid,
    'trackarr:bytes': input.bytes,
    'trackarr:reason': input.reason,
    'trackarr:periodStart': input.periodStart.toISOString(),
    'trackarr:periodEnd': input.periodEnd.toISOString(),
    published: input.periodEnd.toISOString(),
    'trackarr:issuer': input.issuerDid,
    'trackarr:replaces': null,
  } as unknown as UnsignedRecord;
}

export interface ApplyResult {
  applied: boolean;
  bytes: number;
  reason?: string;
}

function asSafeBytes(v: unknown): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) return 0;
  return Math.min(v, MAX_BYTES_PER_ATTESTATION);
}

/**
 * Verify and honour one attestation from `peer`. Idempotent and capped. Never
 * throws on bad input — a stranger's bytes get a reason, not an exception.
 */
export async function applyContributionAttestation(opts: {
  record: unknown;
  peer: { id: string; publicKey: string | null };
}): Promise<ApplyResult> {
  const { record, peer } = opts;
  if (!(await getCreditEnabled())) return { applied: false, bytes: 0, reason: 'disabled' };
  if (!peer.publicKey) return { applied: false, bytes: 0, reason: 'peer has no key' };

  if (!record || typeof record !== 'object') {
    return { applied: false, bytes: 0, reason: 'malformed' };
  }
  const doc = record as Record<string, unknown>;
  if (doc.type !== CONTRIBUTION_TYPE) {
    return { applied: false, bytes: 0, reason: 'wrong type' };
  }

  // The proof must be valid AND signed by the peer that sent it — an attestation
  // is only worth the key behind it.
  const verdict = verifyRecord(record);
  if (!verdict.ok) return { applied: false, bytes: 0, reason: verdict.reason };
  const peerDid = didKeyFromPublicKey(peer.publicKey);
  if (verdict.signer !== peerDid || doc['trackarr:issuer'] !== peerDid) {
    return { applied: false, bytes: 0, reason: 'issuer is not the sending peer' };
  }

  const id = doc.id;
  const subjectDid = doc['trackarr:subject'];
  if (typeof id !== 'string' || typeof subjectDid !== 'string') {
    return { applied: false, bytes: 0, reason: 'missing id/subject' };
  }
  const claimed = asSafeBytes(doc['trackarr:bytes']);
  const reason = typeof doc['trackarr:reason'] === 'string' ? (doc['trackarr:reason'] as string) : null;

  // The subject must be a live local member. A revoked key is not credited — the
  // person may be gone, or the key leaked.
  const [key] = await db
    .select({ userId: schema.userSigningKeys.userId })
    .from(schema.userSigningKeys)
    .where(
      and(
        eq(schema.userSigningKeys.did, subjectDid),
        sql`${schema.userSigningKeys.revokedAt} IS NULL`,
      ),
    )
    .limit(1);
  if (!key) return { applied: false, bytes: 0, reason: 'subject not a local member' };
  const localUserId = key.userId;

  const cap = await getCreditDailyCapBytes();

  return db.transaction(async (tx) => {
    // Serialise the cap check for this member: two attestations arriving together
    // must not both read the pre-credit total and both credit up to the cap.
    await tx.execute(sql`SELECT id FROM ${schema.users} WHERE id = ${localUserId} FOR UPDATE`);

    // The cap is per MEMBER, across all peers — it bounds how much bonus ratio
    // any one member can gain in a day, which is the inflation that matters. Note
    // the blast radius of a single dishonest/compromised (but accounts-accepted)
    // peer is bounded only by this per-member ceiling times the member count: it
    // could name every member up to the cap. That is inside the stated trust
    // model — you enable crediting only for a partner you trust to be honest
    // about bytes — but an operator wary of a partner should keep the cap low.
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [usedRow] = await tx
      .select({ used: sql<number>`coalesce(sum(${schema.federationCreditGrants.bytes}), 0)::bigint` })
      .from(schema.federationCreditGrants)
      .where(
        and(
          eq(schema.federationCreditGrants.localUserId, localUserId),
          gte(schema.federationCreditGrants.createdAt, since),
        ),
      );
    const used = Number(usedRow?.used ?? 0);
    const credited = Math.max(0, Math.min(claimed, cap - used));

    // The row id IS the attestation's content address, so a replay conflicts and
    // credits nothing. An over-cap attestation still lands (bytes clamped, maybe
    // 0) so it is not re-processed forever.
    const inserted = await tx
      .insert(schema.federationCreditGrants)
      .values({ id, peerId: peer.id, subjectDid, localUserId, bytes: credited, reason })
      .onConflictDoNothing({ target: schema.federationCreditGrants.id })
      .returning({ id: schema.federationCreditGrants.id });
    if (!inserted.length) return { applied: false, bytes: 0, reason: 'duplicate' };

    if (credited > 0) {
      await tx
        .update(schema.users)
        .set({ bonusUploaded: sql`${schema.users.bonusUploaded} + ${credited}` })
        .where(eq(schema.users.id, localUserId));
    }
    return { applied: true, bytes: credited };
  });
}

/**
 * Sign contribution attestations for a peer's members that OUR instance served,
 * and deliver them over the accounts channel. The seam M4's accounting calls;
 * returns how many the peer accepted. Best-effort — a delivery failure is retried
 * by the next settlement, since attestations are idempotent on the receiver.
 */
export async function issueContributions(
  peer: { baseUrl: string; instanceId: string | null },
  items: Array<{
    subjectDid: string;
    bytes: number;
    reason: CreditReason;
    periodStart: Date;
    periodEnd: Date;
  }>,
): Promise<{ sent: number }> {
  if (!items.length) return { sent: 0 };
  const config = await getFederationConfig();
  if (!isFederationLive(config)) return { sent: 0 };
  const privateKeyPem = getPrivateKeyPem(config!);
  if (!privateKeyPem || !config!.instanceId || !config!.publicKey) return { sent: 0 };
  const issuerDid = didKeyFromPublicKey(config!.publicKey);

  const attestations = items
    .filter((i) => asSafeBytes(i.bytes) > 0)
    .map(
      (i) =>
        signRecord(projectContributionAttestation({ ...i, issuerDid }), {
          privateKeyPem,
          did: issuerDid,
        }) as SignedRecord,
    );
  if (!attestations.length) return { sent: 0 };

  const res = await signedPost({
    baseUrl: peer.baseUrl,
    pathname: '/api/federation/contributions',
    body: { attestations },
    instanceId: config!.instanceId,
    privateKeyPem,
    audienceInstanceId: peer.instanceId ?? undefined,
    timeoutMs: 8000,
  }).catch(() => null);

  return { sent: res?.status === 200 ? attestations.length : 0 };
}
