import { count, eq, and, isNull, sql } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, bannedIps, invitations } from '@trackarr/db/schema';
import { generateToken } from '~~/utils/server';
import {
  isRegistrationOpen,
  setRegistrationOpen,
  getStarterUpload,
  isInviteEnabled,
  getDefaultInvites,
} from '~~/utils/server';
import { validateBody, registerSchema } from '~~/utils/schemas';
import { verifyPoWSolution } from '~~/utils/pow';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/**
 * Postgres advisory lock id used to serialise the "first user gets
 * admin" branch of registration. Two concurrent POSTs hitting an
 * empty users table would both see `count === 0` and both INSERT
 * with `isAdmin = true`, leaving the instance with two unintended
 * admins. The lock turns that race into a queue: the first
 * transaction commits the admin row, the second sees `count > 0`
 * and falls through to the normal-user branch.
 *
 * The id is arbitrary; any 32-bit value not used elsewhere works.
 */
const REGISTER_FIRST_USER_LOCK_ID = 0x52454749; // "REGI"

/**
 * POST /api/auth/register
 * Register new user with Zero Knowledge Encryption
 * Server never receives password - only verifier and salt
 */
export default defineEventHandler(async (event) => {
  // PoW solo isn't enough at low difficulty (~0.5–2s solve). Pair with
  // the strict auth bucket: 5 tries / 5 min / IP, progressive lockout.
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await validateBody(event, registerSchema);

  // Verify Proof of Work first (anti-abuse)
  const powValid = await verifyPoWSolution({
    challenge: body.powChallenge,
    nonce: body.powNonce,
    hash: body.powHash,
  });
  
  if (!powValid) {
    throw createError({
      statusCode: 400,
      message: 'Invalid or expired proof of work. Please refresh and try again.',
    });
  }

  // Check if IP is banned. getClientIP honors TRUST_PROXY so a client behind
  // an untrusted proxy can't forge X-Forwarded-For to bypass the ban.
  const clientIp = getClientIP(event);

  if (clientIp && clientIp !== 'unknown') {
    const isBanned = await db
      .select()
      .from(bannedIps)
      .where(eq(bannedIps.ip, clientIp))
      .limit(1)
      .then((r) => r.length > 0);

    if (isBanned) {
      throw createError({
        statusCode: 403,
        message: 'Your IP address is banned',
      });
    }
  }

  // We need a stable read of "is the table empty?" that survives
  // concurrent registrations. We take the advisory lock right away
  // and hold it across the count read AND the insert — releasing
  // only when the transaction commits at the bottom of the handler.
  // The downstream invite-validation and username uniqueness checks
  // stay above the transaction (they have their own atomicity:
  // unique constraint on username, atomic decrement on
  // invitesRemaining, etc.) so the lock window stays as small as
  // possible.
  //
  // Outside the transaction we still need an early `isFirstUser`
  // value to decide whether the panic-password is required and
  // which validation rules to run. We compute it from a non-locking
  // count and re-check inside the transaction to settle the race
  // before the INSERT.
  const userCount = await db.select({ count: count() }).from(users);
  const isFirstUser = userCount[0].count === 0;

  // If not first user, check if registration is open or invite code is valid
  let validInvite = null;
  if (!isFirstUser) {
    const regOpen = await isRegistrationOpen();
    const inviteEnabled = await isInviteEnabled();

    // Check invite code if provided
    if (body.inviteCode && inviteEnabled) {
      validInvite = await db.query.invitations.findFirst({
        where: and(
          eq(invitations.code, body.inviteCode.toUpperCase()),
          isNull(invitations.usedBy)
        ),
      });

      // If invite code provided but not found/valid, throw error immediately
      if (!validInvite) {
        throw createError({
          statusCode: 400,
          message: 'Invalid invite code',
        });
      }

      // Check if invite is expired
      if (
        validInvite?.expiresAt &&
        new Date(validInvite.expiresAt) < new Date()
      ) {
        throw createError({
          statusCode: 403,
          message: 'Invite code has expired',
        });
      }
    }

    // Registration blocked if: not open AND no valid invite
    if (!regOpen && !validInvite) {
      throw createError({
        statusCode: 403,
        message: inviteEnabled
          ? 'Registration is closed. A valid invite code is required.'
          : 'Registration is currently closed',
      });
    }
  }

  // Check for existing username
  const existingUsername = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.username, body.username))
    .limit(1);

  if (existingUsername.length > 0) {
    throw createError({
      statusCode: 409,
      message: 'Username already taken',
    });
  }

  // Create user with ZKE credentials (no password hash - we store verifier)
  const userId = crypto.randomUUID();
  const passkey = generateToken(16); // 32-char hex string for tracker auth
  const starterUpload = await getStarterUpload();
  const defaultInvites = await getDefaultInvites();

  // For first user, require and hash panic password
  let panicPasswordHash: string | null = null;
  if (isFirstUser) {
    if (!body.panicPassword) {
      throw createError({
        statusCode: 400,
        message: 'Panic password is required for admin account',
      });
    }
    panicPasswordHash = await hashPassword(body.panicPassword);
  }

  // Atomic block: take the first-user lock, re-check the user count
  // under the lock, INSERT with the settled `isAdmin` flag, and burn
  // the invite (if any) in the same transaction. Anything that can
  // fail here rolls back as a unit — no partially-created admin
  // accounts, no consumed-but-unattributed invites.
  const finalIsFirstUser = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${REGISTER_FIRST_USER_LOCK_ID}::bigint)`
    );

    // Re-check under the lock. A concurrent registration that won
    // the race has already committed by now, so `c > 0` means we're
    // a regular member regardless of what the unlocked read above
    // said.
    const [{ count: cNow }] = await tx.select({ count: count() }).from(users);
    const settledFirstUser = cNow === 0;

    await tx.insert(users).values({
      id: userId,
      username: body.username,
      authSalt: body.authSalt,
      authVerifier: body.authVerifier,
      passkey,
      isAdmin: settledFirstUser,
      isModerator: false,
      lastIp: clientIp !== 'unknown' ? clientIp : null,
      uploaded: starterUpload,
      invitesRemaining: settledFirstUser ? 10 : defaultInvites,
      panicPasswordHash,
    });

    // Mark invite as used inside the same transaction so the row
    // is never consumed without a matching new user row landing.
    if (validInvite) {
      await tx
        .update(invitations)
        .set({
          usedBy: userId,
          usedAt: new Date(),
        })
        .where(eq(invitations.id, validInvite.id));
    }

    return settledFirstUser;
  });

  // If first user, close registration by default. Outside the
  // transaction because `setSetting` writes to a different table
  // and Redis; bundling it would unnecessarily widen the locked
  // window. A failure here doesn't roll back the new admin user —
  // the operator can flip the switch in /admin/settings.
  if (finalIsFirstUser) {
    await setRegistrationOpen(false);
  }

  // Set user session using nuxt-auth-utils
  await setUserSession(event, {
    user: {
      id: userId,
      username: body.username,
      passkey,
      isAdmin: finalIsFirstUser,
      isModerator: false,
      uploaded: starterUpload,
      downloaded: 0,
    },
    loggedInAt: Date.now(),
  });

  return {
    success: true,
    isFirstUser: finalIsFirstUser,
    user: {
      id: userId,
      username: body.username,
      isAdmin: finalIsFirstUser,
      isModerator: false,
      uploaded: starterUpload,
      downloaded: 0,
    },
  };
});
