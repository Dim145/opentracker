import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@trackarr/db';
import { users, bannedIps } from '@trackarr/db/schema';
import { validateBody, loginSchema } from '~~/utils/schemas';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

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

  // Set user session using nuxt-auth-utils
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

  return {
    success: true,
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
