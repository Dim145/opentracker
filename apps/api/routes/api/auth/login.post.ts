import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@trackarr/db';
import { users, bannedIps, webauthnCredentials } from '@trackarr/db/schema';
import { validateBody, loginSchema } from '~~/utils/schemas';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { mintChallengeToken, markFreshAuth } from '~~/utils/twoFactor';
import { consumeTrustedDevice } from '~~/utils/trustedDevices';

/**
 * POST /api/auth/login
 * Authenticate user with Zero Knowledge proof
 * User proves knowledge of password without sending it
 */
export default defineEventHandler(async (event) => {
  // 5 tries per 5 minutes per IP, with progressive penalties — keeps
  // online brute-force of ZK proofs out of reach.
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await validateBody(event, loginSchema);

  // Verify challenge is valid and get associated user ID
  const userId = await redis.get(`login:${body.challenge}`);
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Invalid or expired challenge',
    });
  }
  
  // Delete challenge immediately to prevent reuse
  await redis.del(`login:${body.challenge}`);
  
  // Find user by ID from challenge
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((r) => r[0]);

  if (!user || user.username !== body.username) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }

  // Check if user is banned
  if (user.isBanned) {
    throw createError({
      statusCode: 403,
      message: 'Your account has been banned',
    });
  }

  // Check if IP is banned. getClientIP honors TRUST_PROXY so a client behind
  // an untrusted proxy can't forge X-Forwarded-For to bypass the ban.
  const clientIp = getClientIP(event);

  if (clientIp && clientIp !== 'unknown') {
    const isIpBanned = await db
      .select()
      .from(bannedIps)
      .where(eq(bannedIps.ip, clientIp))
      .limit(1)
      .then((r) => r.length > 0);

    if (isIpBanned) {
      throw createError({
        statusCode: 403,
        message: 'Your IP address is banned',
      });
    }
  }

  // Verify ZKE proof
  // Expected proof = SHA256(authVerifier + challenge)
  if (!user.authVerifier) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }
  
  const expectedProof = createHash('sha256')
    .update(user.authVerifier + body.challenge)
    .digest('hex');

  // Constant-time comparison to prevent timing-attack leakage of the proof.
  if (!secureCompare(body.proof, expectedProof)) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }

  // Update last seen and IP
  await db
    .update(users)
    .set({
      lastSeen: new Date(),
      lastIp: clientIp !== 'unknown' ? clientIp : null,
    })
    .where(eq(users.id, user.id));

  // ── 2FA gate ────────────────────────────────────────────────
  // If the user has any second factor configured (TOTP or at least
  // one passkey) we DON'T open a session yet. Instead we mint a
  // short-lived challenge token; the client trades it on
  // /api/auth/2fa/verify with a valid code or assertion to get the
  // real session cookie.
  const passkeyCount = await db
    .select({ id: webauthnCredentials.id })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, user.id))
    .then((r) => r.length);
  const hasTotp = !!user.totpEnabled;
  const hasPasskey = passkeyCount > 0;

  if (hasTotp || hasPasskey) {
    // Trusted-device fast path: if the browser carries a valid
    // `trackarr_td` cookie that pins to this user, skip the 2FA
    // step entirely. The user opted into this in settings; a
    // cookie that doesn't match falls through to the challenge as
    // if there were no opt-in.
    const td = await consumeTrustedDevice(event, user.id);
    if (!td) {
      const token = await mintChallengeToken(user.id);
      return {
        requires2FA: true,
        challengeToken: token,
        // Tell the FE which method pickers to render. Recovery code
        // is implicit when TOTP is on — adding it explicitly keeps
        // the segmented control predictable.
        methods: [
          ...(hasTotp ? (['totp', 'recovery'] as const) : []),
          ...(hasPasskey ? (['passkey'] as const) : []),
        ],
      };
    }
    // Fall through to the no-2FA session-issue path below — but
    // mark the response so the FE can show a "Trusted device used"
    // notice for transparency.
    (event.context as any).trustedDeviceUsed = true;
  }

  // No 2FA configured — open the session straight away (legacy path).
  await setUserSession(event, {
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      theme: user.theme,
      passkey: user.passkey,
      isAdmin: user.isAdmin,
      isModerator: user.isModerator,
      uploaded: user.uploaded,
      downloaded: user.downloaded,
    },
    loggedInAt: Date.now(),
  });

  // Stamp the fresh-auth window even on no-2FA logins so the same
  // settings flow ("change my password" etc.) works either way.
  const session = await getUserSession(event);
  if (session?.id) await markFreshAuth(String(session.id));

  return {
    success: true,
    requires2FA: false,
    user: {
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      isModerator: user.isModerator,
      uploaded: user.uploaded,
      downloaded: user.downloaded,
    },
  };
});
