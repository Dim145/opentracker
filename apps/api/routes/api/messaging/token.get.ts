/**
 * GET /api/messaging/token
 *
 * Mint the bearer the browser hands to the relay, and say where the relay
 * is. The relay verifies a signature and nothing else — it has no session
 * and no rules — so this endpoint is the only place a member's right to
 * listen is decided.
 *
 * 404 when no relay is configured, matching the rest of the surface: an
 * instance without one is an instance where live delivery does not exist,
 * and the page falls back to reloading.
 */
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireDmAccess } from '~~/utils/messaging/guard';
import { getMessagingRoomScope, scopeAdmits } from '~~/utils/settings';
import {
  MESSAGING_TOKEN_TTL_SECONDS,
  signMessagingToken,
} from '~~/utils/messaging/token';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await requireDmAccess(user);
  await rateLimit(event, RATE_LIMITS.stream);

  const url = process.env.MESSAGING_SERVICE_URL;
  const secret = process.env.MESSAGING_TOKEN_SECRET;
  if (!url || !secret) {
    throw createError({ statusCode: 404, message: 'Not found' });
  }

  const exp = Math.floor(Date.now() / 1000) + MESSAGING_TOKEN_TTL_SECONDS;
  // The room has its own scope, so the token says whether this member may
  // listen to it. The client cannot be the one to decide: asking for a
  // channel is not the same as being allowed on it.
  const room = scopeAdmits(await getMessagingRoomScope(), user);

  return {
    url,
    token: signMessagingToken(
      room ? { uid: user.id, exp, rm: true } : { uid: user.id, exp },
      secret
    ),
    expiresAt: exp,
    room,
  };
});
