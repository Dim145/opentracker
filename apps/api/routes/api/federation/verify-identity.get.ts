/**
 * GET /api/federation/verify-identity?username=&code=  — inbound, S2S.
 *
 * A partner asks us to confirm that the local user `username` placed `code`
 * in their profile bio (proof they own the account). Returns only a boolean
 * — never the bio itself. Gated on the `accounts` scope.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  getFederationConfig,
  isFederationLive,
} from '~~/utils/federation/config';
import { verifySignedRequest } from '~~/utils/federation/signing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);

  const config = await getFederationConfig();
  if (!isFederationLive(config)) {
    throw createError({ statusCode: 404, message: 'Federation not enabled' });
  }

  const headers = getRequestHeaders(event);
  const senderId = headers['x-trackarr-instance'];
  if (!senderId) {
    throw createError({ statusCode: 401, message: 'Missing instance header' });
  }

  const [peer] = await db
    .select()
    .from(schema.federationPeers)
    .where(eq(schema.federationPeers.instanceId, senderId))
    .limit(1);
  if (!peer || !peer.publicKey) {
    throw createError({ statusCode: 404, message: 'Unknown peer' });
  }
  if (peer.status !== 'active') {
    throw createError({ statusCode: 403, message: 'Peer not active' });
  }
  if (!peer.sharesWithThem?.accounts) {
    throw createError({ statusCode: 403, message: 'Accounts not shared with this peer' });
  }

  const verdict = verifySignedRequest({
    method: 'GET',
    pathname: event.path,
    rawBody: '',
    headers,
    publicKeyPem: peer.publicKey,
  });
  if (!verdict.ok) {
    throw createError({
      statusCode: 401,
      message: `Signature rejected: ${verdict.reason}`,
    });
  }

  const q = getQuery(event);
  const username = typeof q.username === 'string' ? q.username.trim() : '';
  const code = typeof q.code === 'string' ? q.code.trim() : '';
  // The code MUST be a verification token in our issued format
  // (`trackarr-verify-<hex>`), never an arbitrary substring — otherwise a
  // partner could turn this into a bio-content oracle (probe any 6-char
  // substring of a user's bio) or trivially spoof a link (code="trackarr"
  // matching any bio that mentions us).
  if (!username || !/^trackarr-verify-[0-9a-f]{12,}$/.test(code)) {
    throw createError({
      statusCode: 400,
      message: 'username and a valid verification code required',
    });
  }

  const [u] = await db
    .select({ bio: schema.users.bio })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  const matched = !!u?.bio && u.bio.includes(code);
  return { ok: true, matched };
});
