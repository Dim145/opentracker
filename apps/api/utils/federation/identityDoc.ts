/**
 * "This is me" — a portable, verifiable statement of who a member is.
 *
 * A member's `did:key` names them across the federation, but a name on its own
 * says nothing: anyone can generate a keypair and announce that it is `Nova`.
 * What makes the name usable somewhere else is a document that ties three
 * things together, each signed by whoever is entitled to assert it.
 *
 * ## Two signatures, because there are two different claims
 *
 * **The subject's proof** says: whoever wrote this holds the key the DID names.
 * It is what stops a stranger from claiming somebody else's identifier.
 *
 * **The instance's endorsement** says: that DID is our member `Nova`. It is the
 * only part that connects a key to a history — an account, an upload record, a
 * reputation — because the instance is the only party that ever knew both.
 *
 * Either one alone is worthless for moving between instances. Without the
 * endorsement, the claim is "I hold a key and I say I am Nova", which is free
 * to manufacture. Without the subject's proof, the endorsement is a statement
 * about a key nobody has shown they hold.
 *
 * ## What it is honestly worth today
 *
 * Less than it will be. The member's private key is held by their instance
 * until they hold it themselves, so an instance could mint this document
 * without them. That does not make it useless — it moves the trust from "B
 * believes a stranger" to "B believes A about A's own member", which is the
 * same thing B already does when it mirrors A's catalogue — but it is a
 * different claim from the one this shape will make later, and the code should
 * not pretend otherwise.
 *
 * ## The sentence that matters more than the code
 *
 * The document carries a plain-language note about what does and does not
 * travel with it. Identity and authorship travel. Ratio, bonus points and
 * invitations do not: they are a debt to one swarm population and one
 * community, and they mean nothing anywhere else. Somebody has to be told that
 * BEFORE they move, and the file they carry is the one thing guaranteed to
 * still be in front of them when they arrive.
 */
import { canonicalBytes } from './jcs';
import { checkProof, makeProof, type DataIntegrityProof } from './record';

export const IDENTITY_CONTEXT = [
  'https://www.w3.org/ns/activitystreams',
  'https://w3id.org/security/data-integrity/v2',
  { trackarr: 'https://trackarr.org/ns#' },
] as const;

/**
 * What travels, said once, in words. Deliberately inside the exported file and
 * not only in the interface that produced it: the file is what a member still
 * has in front of them when they arrive somewhere else.
 */
export const PORTABILITY_NOTE =
  'Your identity and the uploads attributed to it travel with this key. ' +
  'Your ratio, bonus points, invitations and any standing you have on this ' +
  'instance do not — they are owed to one community and mean nothing ' +
  'elsewhere. Anyone who holds this file can act as you: keep it as you would ' +
  'keep a password, and treat it as compromised if you ever share it.';

export interface IdentityClaim {
  /** `did:key:…` of the member. */
  did: string;
  username: string;
  /** Where they hold that name. */
  instanceUrl: string | null;
  /** `did:key:…` of the instance making the endorsement. */
  instanceDid: string;
  /** Overridable so a test can be deterministic. */
  issuedAt?: Date;
}

export interface IdentityDocument extends Record<string, unknown> {
  '@context': unknown;
  type: 'Person';
  id: string;
  preferredUsername: string;
  published: string;
  'trackarr:instance': string | null;
  'trackarr:instanceDid': string;
  'trackarr:note': string;
  /** The subject's own proof: whoever wrote this holds the key. */
  proof?: DataIntegrityProof;
  /** The instance's: that key is our member, by that name. */
  'trackarr:endorsement'?: DataIntegrityProof;
}

/** The document both signatures cover: everything but the signatures. */
function base(doc: IdentityDocument): Record<string, unknown> {
  const {
    proof: _p,
    'trackarr:endorsement': _e,
    ...rest
  } = doc as Record<string, unknown>;
  return rest;
}

/**
 * Build and sign the claim.
 *
 * Both proofs cover the SAME bytes — the document without either of them — so
 * neither depends on the other's presence or on the order they were made in.
 * A verifier can check one, the other, or both, and an endorsement can be
 * stripped without invalidating the subject's proof.
 */
export function signIdentity(
  claim: IdentityClaim,
  keys: {
    subjectPrivateKeyPem: string;
    instancePrivateKeyPem: string;
  },
): IdentityDocument {
  const doc: IdentityDocument = {
    '@context': IDENTITY_CONTEXT,
    type: 'Person',
    id: claim.did,
    preferredUsername: claim.username,
    published: (claim.issuedAt ?? new Date()).toISOString(),
    'trackarr:instance': claim.instanceUrl,
    'trackarr:instanceDid': claim.instanceDid,
    'trackarr:note': PORTABILITY_NOTE,
  };

  const body = base(doc);
  const created = claim.issuedAt;
  doc.proof = makeProof(body, {
    privateKeyPem: keys.subjectPrivateKeyPem,
    did: claim.did,
    created,
  });
  doc['trackarr:endorsement'] = makeProof(body, {
    privateKeyPem: keys.instancePrivateKeyPem,
    did: claim.instanceDid,
    created,
  });
  return doc;
}

export interface IdentityVerdict {
  ok: boolean;
  reason?: string;
  /** The DID that signed as the subject, once its proof checks out. */
  subject?: string;
  username?: string;
  instanceUrl?: string | null;
  /** The instance DID whose endorsement checked out, if there was one. */
  endorsedBy?: string;
}

/**
 * Verify a claim on its own terms.
 *
 * Total, like everything that runs on a stranger's bytes: a malformed document
 * is a verdict, never an exception. Two checks that are easy to skip and
 * expensive to have skipped:
 *
 * - the subject's proof must be made by **the key the `id` names**, not merely
 *   by some valid key. Accepting any signature would let anybody endorse
 *   anybody's identifier.
 * - the endorsement is reported, never required. Whether an unendorsed claim
 *   is worth anything is a decision for whoever receives it — this function
 *   says what held, and the caller decides what that is worth.
 */
export function verifyIdentity(input: unknown): IdentityVerdict {
  try {
    if (!input || typeof input !== 'object') {
      return { ok: false, reason: 'not an object' };
    }
    const doc = input as IdentityDocument;
    if (doc.type !== 'Person') return { ok: false, reason: 'not a Person' };
    if (typeof doc.id !== 'string' || !doc.id.startsWith('did:key:')) {
      return { ok: false, reason: 'no did:key subject' };
    }
    if (typeof doc.preferredUsername !== 'string' || !doc.preferredUsername) {
      return { ok: false, reason: 'no username' };
    }
    // Canonicalising here rather than at signing time is what catches a
    // document carrying something that cannot be signed at all — a NaN, an
    // undefined, a cycle — before any of it is believed.
    canonicalBytes(base(doc));

    const subject = checkProof(base(doc), doc.proof);
    if (!subject.ok) {
      return { ok: false, reason: `subject proof: ${subject.reason}` };
    }
    if (subject.signer !== doc.id) {
      // Signed by a real key, just not the one this document claims to be.
      return { ok: false, reason: 'subject proof is by another key' };
    }

    const endorsement = doc['trackarr:endorsement']
      ? checkProof(base(doc), doc['trackarr:endorsement'])
      : null;
    const endorsedBy =
      endorsement?.ok && endorsement.signer === doc['trackarr:instanceDid']
        ? endorsement.signer
        : undefined;

    return {
      ok: true,
      subject: doc.id,
      username: doc.preferredUsername,
      instanceUrl:
        typeof doc['trackarr:instance'] === 'string'
          ? doc['trackarr:instance']
          : null,
      endorsedBy,
    };
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
}
