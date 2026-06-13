/**
 * GET /api/federation/verify-identity?username=&code=  — inbound, S2S.
 *
 * A partner asks us to confirm that the local user `username` placed `code`
 * in their profile bio (proof they own the account). Returns only a boolean
 * — never the bio itself. Gated on the `accounts` scope.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { verifyInboundS2S } from '~~/utils/federation/inbound';

export default defineEventHandler(async (event) => {
  await verifyInboundS2S(event, 'accounts');

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
    .select({ bio: schema.users.bio, isBanned: schema.users.isBanned })
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .limit(1);

  // A banned account can't prove a (still-valid) identity link to a peer —
  // never confirm the bio code for a banned user.
  const matched = !!u?.bio && !u.isBanned && u.bio.includes(code);
  return { ok: true, matched };
});
