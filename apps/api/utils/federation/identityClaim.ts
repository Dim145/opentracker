/**
 * Accepting somebody's claim to be who they were somewhere else.
 *
 * The older way to do this was a code in a profile bio: we hand the member a
 * string, they paste it into their profile on the partner, we ask the partner
 * whether it is there. It works, and it has two properties that matter here.
 * It needs the partner to be **running**, and it needs the member to still
 * **have an account there**. Both are exactly what fails in the case
 * portability exists for — the instance shut down, or threw them out.
 *
 * A signed identity document needs neither. Everything required to check it
 * is inside it: the member's key proves they hold the identifier, the
 * partner's endorsement proves that identifier was their member. Both are
 * verified here, offline, from bytes the member carried.
 *
 * ## The endorsement has to come from somebody we know
 *
 * This is the whole security of it, and it is easy to get wrong in a way that
 * looks generous. A document endorsed by `did:key:zSomeStranger` proves that
 * *some* instance vouched for the claim — and anybody can be an instance. Ten
 * minutes with a keypair buys a document saying you were the top uploader on
 * a tracker you have never seen.
 *
 * So the endorsing key is matched against the partners this instance actually
 * federates with. Not the URL in the document, which is a string the document
 * chose: the key. A claim endorsed by a stranger is refused with a reason,
 * rather than shown with a smaller badge — an unverifiable claim displayed at
 * all is a claim somebody will read as verified.
 *
 * ## What it still does not prove
 *
 * That the human presenting the document is the human who earned the name.
 * The partner holds its members' keys until they hold them themselves, so the
 * partner could have minted this; and whoever ends up with the file can use
 * it. What it proves is that the partner vouched for this identifier under
 * this name — which is precisely what we already believe the partner about
 * when we mirror its catalogue, and no more.
 */
import { randomUUID } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { didKeyFromPublicKey } from './did';
import { verifyIdentity } from './identityDoc';
import { isRevoked } from './identityRecord';

export interface ClaimOutcome {
  ok: boolean;
  /** Why it was refused, in terms the member can act on. */
  reason?: string;
  peerId?: string;
  peerName?: string | null;
  remoteUsername?: string;
  subjectDid?: string;
}

/**
 * Check a claim and say who it belongs to, without writing anything.
 *
 * Separated from the storing so the same check can answer "would this work?"
 * — and so the reasons are one list rather than scattered through a handler.
 */
export async function checkClaim(document: unknown): Promise<ClaimOutcome> {
  const verdict = verifyIdentity(document);
  if (!verdict.ok) {
    return { ok: false, reason: `invalid document: ${verdict.reason}` };
  }
  if (!verdict.endorsedBy) {
    // A document can be perfectly well signed by its subject and still say
    // nothing: "I hold a key and I say I am Nova" is free to manufacture.
    return { ok: false, reason: 'not endorsed by the instance it names' };
  }

  // A withdrawn identifier proves nothing, however good the signatures on it
  // are — and the document will still verify perfectly, because a withdrawal
  // cannot reach back and unmake bytes that were signed before it. This check
  // is the only thing between a leaked file and the identity it names.
  //
  // Asked of the ENDORSER specifically: only the instance that vouched for an
  // identifier can take that back, and a partner announcing withdrawals for
  // keys it never issued must not be able to unpick anybody else's links.
  if (await isRevoked(verdict.subject!, verdict.endorsedBy)) {
    return { ok: false, reason: 'that identifier has been withdrawn by its instance' };
  }

  // Match on the KEY, never on the URL the document carries. A URL is a string
  // the document chose; the key is the thing we already trust.
  const peers = await db
    .select({
      id: schema.federationPeers.id,
      displayName: schema.federationPeers.displayName,
      publicKey: schema.federationPeers.publicKey,
      status: schema.federationPeers.status,
    })
    .from(schema.federationPeers);

  const endorser = peers.find((p) => {
    if (!p.publicKey) return false;
    try {
      return didKeyFromPublicKey(p.publicKey) === verdict.endorsedBy;
    } catch {
      return false;
    }
  });

  if (!endorser) {
    return { ok: false, reason: 'this instance does not federate with the endorser' };
  }
  if (endorser.status !== 'active') {
    return { ok: false, reason: 'the endorsing partner is not active here' };
  }

  return {
    ok: true,
    peerId: endorser.id,
    peerName: endorser.displayName,
    remoteUsername: verdict.username,
    subjectDid: verdict.subject,
  };
}

/**
 * Check a claim and record it against a local member.
 *
 * One remote identity belongs to at most one local account. If the same DID on
 * the same partner is already linked to somebody else, this refuses rather
 * than moving it: whoever holds the file can present it, so a silent takeover
 * of an established link is the worse of the two failures. An operator can
 * unpick a genuine dispute; nobody can unpick one they were never told about.
 *
 * The check and the insert are one transaction under an advisory lock on
 * `(peer, subject)`, because the rule is a read-then-write and the table has no
 * unique index that expresses it — `federated_identities_unique` is over
 * `(local_user_id, peer_id, remote_username)`, which says nothing about the
 * subject DID. Two accounts posting the same leaked document at the same moment
 * both read "not taken" and both wrote, which is exactly the takeover the
 * paragraph above says must not happen quietly. A lock rather than a new index:
 * the constraint is conditional on the OTHER account, so it is not a shape a
 * unique index states, and adding one over `(peer_id, subject_did)` would fail
 * to build on any database where the race had already happened.
 */
export async function recordClaim(
  localUserId: string,
  document: unknown,
): Promise<ClaimOutcome> {
  const check = await checkClaim(document);
  if (!check.ok) return check;

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(7412, hashtext(${`${check.peerId}:${check.subjectDid}`}))`,
    );

    const [taken] = await tx
      .select({ id: schema.federatedIdentities.id })
      .from(schema.federatedIdentities)
      .where(
        and(
          eq(schema.federatedIdentities.peerId, check.peerId!),
          eq(schema.federatedIdentities.subjectDid, check.subjectDid!),
          ne(schema.federatedIdentities.localUserId, localUserId),
        ),
      )
      .limit(1);
    if (taken) {
      return { ok: false, reason: 'already linked to another account here' };
    }

    const row = {
      status: 'verified',
      method: 'key',
      subjectDid: check.subjectDid!,
      // Kept so the link can be published with its proof attached. A partner's
      // word that two identifiers are one person is worth what the document it
      // saw is worth, and only one of those two can be handed on.
      evidence: document as Record<string, unknown>,
      remoteUsername: check.remoteUsername!,
      // A proven link has no code to be pasted anywhere. Leaving a stale one
      // behind would be a live credential for a flow this one replaces.
      verifyCode: null,
      verifiedAt: new Date(),
    };

    await tx
      .insert(schema.federatedIdentities)
      .values({
        id: randomUUID(),
        localUserId,
        peerId: check.peerId!,
        ...row,
      })
      .onConflictDoUpdate({
        target: [
          schema.federatedIdentities.localUserId,
          schema.federatedIdentities.peerId,
          schema.federatedIdentities.remoteUsername,
        ],
        set: row,
      });

    return check;
  });
}

