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
 * - **Relationship-bound**: the peer may only credit a member who has a proven
 *   identity ON that peer. Without this a single accounts-accepted partner could
 *   name EVERY local member — member DIDs are published in our own catalogue
 *   records — and mint the per-member cap for each of them. The predicate is the
 *   one `fillersForPeer` already uses, and it turns "cap x every member" into
 *   "cap x the members who actually cross to this partner".
 * - **Audience-bound**: an attestation names the instance it is for, so one
 *   cannot be delivered to two instances that both know the member's key.
 * - **Period-bound**: the settlement window is verified, rate-clamped at the
 *   same 80 MiB/s the announce anti-cheat uses, and required to start where the
 *   last one for that (peer, member) ended. Content-address dedup alone was not
 *   enough: moving `periodEnd` a millisecond re-addressed the same real transfer
 *   to a new id and credited it twice.
 * - Idempotent: the ledger row id IS the attestation's content address, so a
 *   replay credits nothing.
 * - Capped three ways: per member, per peer and instance-wide per rolling day,
 *   under a row lock so concurrent attestations cannot race past the ceiling.
 * - Ban- and erasure-aware: neither a banned nor an erased account is credited,
 *   matching `PUBLISHABLE` on the minting side.
 * - Credits `bonus_uploaded`, never real `uploaded`: it moves ratio without ever
 *   claiming the member seeded on THIS tracker.
 */
import { and, eq, gt, gte, isNull, sql } from 'drizzle-orm';
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

/**
 * The rate a claim is measured against — the same 80 MiB/s the announce
 * anti-cheat clamps a delta to (`anticheat.Config.MaxUploadBytesPerSecond`).
 *
 * Deliberately the same number. An attestation says "your member pulled N bytes
 * between t0 and t1", which is the identical shape of assertion an announce
 * makes, and there is no reason to believe a partner's wire more than a
 * member's. Without it a one-second window could carry 5 TiB.
 */
const MAX_BYTES_PER_SECOND = 80 * 1024 ** 2; // 80 MiB/s

/**
 * A settlement window may not be longer than this, nor may its end be older.
 *
 * The length bound stops a first-ever attestation buying itself an enormous
 * rate ceiling by claiming to cover 2019-to-now. The age bound stops a partner
 * charging today's daily budget for month-old bytes — delivery is retried by
 * design, so being generous costs nothing, but "forever" is not a window.
 */
const MAX_PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Tolerance for a partner's clock, matching the S2S signature skew window. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

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
 * The two ceilings above the per-member one. Both default to 0 = unbounded,
 * because a low default would silently throttle a legitimate mesh on upgrade;
 * what was missing was the lever, not a number. An operator wary of one partner
 * sets the per-peer cap; one wary of total inflation sets the instance cap.
 */
async function optionalCapBytes(key: string): Promise<number | null> {
  const raw = await getSetting(key);
  const n = raw ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

export function getCreditPeerDailyCapBytes(): Promise<number | null> {
  return optionalCapBytes(SETTINGS_KEYS.FEDERATION_CREDIT_PEER_DAILY_CAP_BYTES);
}

export function getCreditInstanceDailyCapBytes(): Promise<number | null> {
  return optionalCapBytes(
    SETTINGS_KEYS.FEDERATION_CREDIT_INSTANCE_DAILY_CAP_BYTES,
  );
}

/**
 * The attestation document. `published` is the period end, not "now", so the same
 * logical settlement always addresses to the same id (idempotent by construction).
 *
 * `trackarr:audience` names the instance the attestation is FOR. Everything else
 * here is a statement about a member's key, and a member may hold the same key
 * on two instances — that is the point of a portable identity. Without an
 * audience, one attestation delivered twice credits the same bytes on both, and
 * the receiver cannot tell. It is the same fix, for the same reason, as the
 * audience binding on the S2S signature itself.
 */
export function projectContributionAttestation(input: {
  subjectDid: string;
  bytes: number;
  reason: CreditReason;
  periodStart: Date;
  periodEnd: Date;
  issuerDid: string;
  audienceInstanceId: string;
}): UnsignedRecord {
  return {
    '@context': CONTEXT,
    type: CONTRIBUTION_TYPE,
    'trackarr:subject': input.subjectDid,
    'trackarr:audience': input.audienceInstanceId,
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

/** An ISO instant, or null. Rejects anything `Date` would coerce into nonsense. */
function asInstant(v: unknown): Date | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t) : null;
}

/**
 * The settlement window, checked for the things a signature cannot tell us.
 *
 * The document signs a period and the first version of this function read none
 * of it — so a 5 TiB claim over one second was honoured, a period ending in 2099
 * was honoured, and re-issuing the same real transfer with `periodEnd` nudged a
 * millisecond produced a different content address and therefore a second
 * credit. The signature was never the missing part.
 */
function checkPeriod(doc: Record<string, unknown>):
  | { ok: true; start: Date; end: Date; ceiling: number }
  | { ok: false; reason: string } {
  const start = asInstant(doc['trackarr:periodStart']);
  const end = asInstant(doc['trackarr:periodEnd']);
  if (!start || !end) return { ok: false, reason: 'missing or unparseable period' };

  const span = end.getTime() - start.getTime();
  if (span <= 0) return { ok: false, reason: 'period does not advance' };
  if (span > MAX_PERIOD_MS) return { ok: false, reason: 'period too long' };

  const now = Date.now();
  if (end.getTime() > now + MAX_CLOCK_SKEW_MS) {
    return { ok: false, reason: 'period ends in the future' };
  }
  if (now - end.getTime() > MAX_PERIOD_MS) {
    return { ok: false, reason: 'period too old' };
  }

  return {
    ok: true,
    start,
    end,
    ceiling: Math.floor((span / 1000) * MAX_BYTES_PER_SECOND),
  };
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
  const reason = typeof doc['trackarr:reason'] === 'string' ? (doc['trackarr:reason'] as string) : null;

  // Is this attestation even addressed to us? A member may legitimately hold the
  // same key on two instances, so an unaddressed attestation is one that credits
  // the same bytes wherever it is delivered.
  const config = await getFederationConfig();
  if (!config?.instanceId) {
    return { applied: false, bytes: 0, reason: 'no local instance identity' };
  }
  if (doc['trackarr:audience'] !== config.instanceId) {
    return { applied: false, bytes: 0, reason: 'attestation is not addressed to this instance' };
  }

  const period = checkPeriod(doc);
  if (!period.ok) return { applied: false, bytes: 0, reason: period.reason };

  // Two independent bounds on what one attestation may claim: an absolute floor
  // of sanity, and the rate the window could physically have carried.
  const claimed = Math.min(asSafeBytes(doc['trackarr:bytes']), period.ceiling);

  // The subject must be a live local member, not banned and not erased. A revoked
  // key is not credited either — the person may be gone, or the key leaked.
  //
  // Banned and erased are excluded to match `PUBLISHABLE` on the minting side:
  // bonus upload accrued behind a ban is ratio waiting to materialise on unban,
  // and an erased account is one this instance has undertaken to stop carrying.
  const [key] = await db
    .select({ userId: schema.users.id })
    .from(schema.userSigningKeys)
    .innerJoin(schema.users, eq(schema.users.id, schema.userSigningKeys.userId))
    .where(
      and(
        eq(schema.userSigningKeys.did, subjectDid),
        isNull(schema.userSigningKeys.revokedAt),
        eq(schema.users.isBanned, false),
        isNull(schema.users.deletedAt),
      ),
    )
    .limit(1);
  if (!key) return { applied: false, bytes: 0, reason: 'subject not a creditable local member' };
  const localUserId = key.userId;

  // The peer must have a proven relationship with the member it is crediting.
  //
  // This is the check whose absence let one accounts-accepted partner name every
  // member on the instance: DIDs are published in our own catalogue records, so
  // the list is not a secret and never was. `federatedIdentities` already carries
  // exactly the fact needed — this member proved an account on that peer — and
  // `fillersForPeer` already reads it this way.
  //
  // If a future data source (a webseed relay serving members with no account on
  // the serving side) needs another relation, it is an OR added here, in one
  // place, deliberately — not an absent predicate.
  const [link] = await db
    .select({ id: schema.federatedIdentities.id })
    .from(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.localUserId, localUserId),
        eq(schema.federatedIdentities.peerId, peer.id),
        eq(schema.federatedIdentities.status, 'verified'),
      ),
    )
    .limit(1);
  if (!link) {
    return {
      applied: false,
      bytes: 0,
      reason: 'no proven identity for this member on the sending peer',
    };
  }

  const [cap, peerCap, instanceCap] = await Promise.all([
    getCreditDailyCapBytes(),
    getCreditPeerDailyCapBytes(),
    getCreditInstanceDailyCapBytes(),
  ]);

  return db.transaction(async (tx) => {
    // Serialise this member's settlement: two attestations arriving together must
    // not both read the pre-credit total, and — since the subject resolves to one
    // member — this also serialises the high-water-mark check below.
    await tx.execute(sql`SELECT id FROM ${schema.users} WHERE id = ${localUserId} FOR UPDATE`);

    // An exact replay is the honest case and is answered first: delivery is
    // best-effort and retried by the next settlement, so the same attestation
    // arriving twice must read as idempotent rather than as an overlap. The
    // `onConflictDoNothing` below is still the race backstop; this is what makes
    // the ANSWER right, and it has to come before the window check — which the
    // replay's own settled row would otherwise trip.
    const [already] = await tx
      .select({ id: schema.federationCreditGrants.id })
      .from(schema.federationCreditGrants)
      .where(eq(schema.federationCreditGrants.id, id))
      .limit(1);
    if (already) return { applied: false, bytes: 0, reason: 'duplicate' };

    // The window must start where the last one for this (peer, member) ended.
    // Without it the ledger dedups on content address alone, and a partner
    // re-issues the same bytes under a window shifted by a millisecond.
    //
    // Asked as "is there a settled window ending after this one starts", in
    // SQL, rather than by reading a `max()` back and comparing in JavaScript.
    // Two reasons: it rides `federation_credit_grants_period_idx` directly, and
    // a Postgres timestamp that becomes a JS string parses as LOCAL time —
    // `new Date("2026-06-13 10:00:00")` shifts by the container's offset, which
    // is a trap this codebase has already paid for once in the mint cursor.
    //
    // A row from before 0043 carries no window: `NULL > x` is NULL, so it
    // establishes no overlap, which is right — it never claimed one.
    const [overlap] = await tx
      .select({ id: schema.federationCreditGrants.id })
      .from(schema.federationCreditGrants)
      .where(
        and(
          eq(schema.federationCreditGrants.peerId, peer.id),
          eq(schema.federationCreditGrants.subjectDid, subjectDid),
          gt(schema.federationCreditGrants.periodEnd, period.start),
        ),
      )
      .limit(1);
    if (overlap) {
      return { applied: false, bytes: 0, reason: 'period overlaps one already settled' };
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const dailySum = (where: ReturnType<typeof and>) =>
      tx
        .select({
          used: sql<number>`coalesce(sum(${schema.federationCreditGrants.bytes}), 0)::bigint`,
        })
        .from(schema.federationCreditGrants)
        .where(where)
        .then((rows) => Number(rows[0]?.used ?? 0));

    // Three ceilings, and the smallest headroom wins. Per member bounds what one
    // account can gain; per peer is the lever for trusting partner A more than
    // partner B; instance-wide is the total-inflation bound. The last two exist
    // because the per-member cap alone gives a dishonest partner a reach of
    // "cap x every member it can name" — narrowed by the relationship check
    // above, but not bounded by it.
    let headroom = cap - (await dailySum(
      and(
        eq(schema.federationCreditGrants.localUserId, localUserId),
        gte(schema.federationCreditGrants.createdAt, since),
      ),
    ));
    if (peerCap !== null) {
      headroom = Math.min(headroom, peerCap - (await dailySum(
        and(
          eq(schema.federationCreditGrants.peerId, peer.id),
          gte(schema.federationCreditGrants.createdAt, since),
        ),
      )));
    }
    if (instanceCap !== null) {
      headroom = Math.min(headroom, instanceCap - (await dailySum(
        gte(schema.federationCreditGrants.createdAt, since),
      )));
    }
    const credited = Math.max(0, Math.min(claimed, headroom));

    // The row id IS the attestation's content address, so a replay conflicts and
    // credits nothing. An over-cap attestation still lands (bytes clamped, maybe
    // 0) so it is not re-processed forever — and its period still advances the
    // high-water mark, which is what makes the clamp stick.
    const inserted = await tx
      .insert(schema.federationCreditGrants)
      .values({
        id,
        peerId: peer.id,
        subjectDid,
        localUserId,
        bytes: credited,
        reason,
        periodStart: period.start,
        periodEnd: period.end,
      })
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

  // No audience, no attestation. A peer we have not handshaked with has no
  // instanceId to bind to, and an unbound attestation is one that credits the
  // same bytes on every instance it reaches — so this refuses to sign rather
  // than issuing something weaker than the receiver requires.
  if (!peer.instanceId) return { sent: 0 };
  const audienceInstanceId = peer.instanceId;

  const attestations = items
    .filter((i) => asSafeBytes(i.bytes) > 0)
    .map(
      (i) =>
        signRecord(
          projectContributionAttestation({ ...i, issuerDid, audienceInstanceId }),
          { privateKeyPem, did: issuerDid },
        ) as SignedRecord,
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
