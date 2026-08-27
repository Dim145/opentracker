/**
 * POST /api/federation/identities/claim — authenticated, local.
 *
 * "I was Nova on that instance", proven rather than asserted. The member
 * presents the identity document they exported from their old instance; this
 * checks both signatures on it and links the two accounts.
 *
 * Nothing leaves this server. The older path — a one-time code in a remote
 * profile bio — has to ask the partner whether the code is there, which needs
 * the partner to be running and the member to still have an account on it.
 * Those are the two things that fail in exactly the case portability is for.
 *
 * The document is a stranger's bytes, so it is treated as such: a 16 KB
 * ceiling before anything is parsed, a total verifier that returns verdicts
 * instead of throwing, and the strict rate-limit bucket — a member links an
 * old account a handful of times in their life, and anything faster is
 * somebody trying documents until one sticks.
 */
import { z } from 'zod';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { assertBodyWithinLimit } from '~~/utils/federation/inbound';
import { recordClaim } from '~~/utils/federation/identityClaim';

const bodySchema = z.object({
  /** The exported document, verbatim. Shape is the verifier's problem. */
  document: z.unknown(),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.auth);
  assertBodyWithinLimit(event);

  const body = await validateBody(event, bodySchema);
  const outcome = await recordClaim(session.user.id, body.document);

  if (!outcome.ok) {
    // The reason is the point of the response: a member who pasted the wrong
    // half of a file, or a document from an instance we do not federate with,
    // can only fix it if they are told which.
    throw createError({ statusCode: 400, message: outcome.reason });
  }

  return {
    ok: true,
    peerId: outcome.peerId,
    peerName: outcome.peerName,
    remoteUsername: outcome.remoteUsername,
    subjectDid: outcome.subjectDid,
  };
});
