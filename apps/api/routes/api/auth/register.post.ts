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
import { notify } from '~~/utils/notify';
import { verifyPoWSolution } from '~~/utils/pow';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { markFreshAuth } from '~~/utils/twoFactor';
import { encryptSecretRequired } from '~~/utils/credentialSecrets';
import { recordLogin } from '~~/utils/account/loginLog';

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
  let validInvite: Awaited<
    ReturnType<typeof db.query.invitations.findFirst>
  > | null = null;
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
  /*
   * Insensible à la casse.
   *
   * Le contrôle et l'index unique portaient tous deux sur la valeur exacte,
   * donc `Admin` pouvait être créé alors qu'`admin` existait. Le jeu de
   * caractères est `[a-zA-Z0-9_-]`, donc pas d'homographes Unicode — mais la
   * collision par casse suffit à usurper un pseudonyme de personnel dans les
   * commentaires, le forum, les messages privés et le journal de modération.
   * Et `auth/challenge` étant lui aussi sensible à la casse, les deux comptes
   * se connectent normalement.
   *
   * L'index unique fonctionnel de la migration est ce qui rend la garantie
   * réelle : ce contrôle-ci répond 409 plutôt que de laisser la base lever une
   * violation de contrainte.
   */
  const existingUsername = await db
    .select({ username: users.username })
    .from(users)
    .where(sql`lower(${users.username}) = ${body.username.toLowerCase()}`)
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
      // Encrypted at rest: the verifier IS the login credential, not a hash
      // of it, so a database dump would otherwise be an account takeover.
      authVerifier: encryptSecretRequired(body.authVerifier),
      passkey,
      isAdmin: settledFirstUser,
      isModerator: false,
      // Same decision, taken under the same lock: the account that sets the
      // instance up owns it. Reading it off `is_admin` later would be wrong —
      // every admin appointed afterwards carries that flag too.
      isOwner: settledFirstUser,
      lastIp: clientIp !== 'unknown' ? clientIp : null,
      uploaded: starterUpload,
      // The starter is ratio relief, not real seeding — counted in
      // the bonus subset so the /me Uploaded KPI shows
      // "X — (incl. Y bonus)" out of the gate. Same invariant as
      // the shop's `upload_credit` apply path.
      bonusUploaded: starterUpload,
      invitesRemaining: settledFirstUser ? 10 : defaultInvites,
      panicPasswordHash,
    });

    // Mark invite as used inside the same transaction so the row
    // is never consumed without a matching new user row landing.
    //
    // The burn is compare-and-swap (`used_by IS NULL` + rowcount check),
    // not a blind UPDATE keyed on id. The eligibility read above runs
    // before the advisory lock, so N concurrent registrations with the
    // same code each saw it unused; an unconditional burn let every one
    // of them INSERT a user and just overwrote `used_by`, minting N
    // accounts from one invite (finding M1). If the guarded UPDATE
    // claims zero rows the invite was already consumed — abort the
    // whole tx so the user INSERT rolls back.
    if (validInvite) {
      const claimed = await tx
        .update(invitations)
        .set({
          usedBy: userId,
          usedAt: new Date(),
        })
        .where(and(eq(invitations.id, validInvite.id), isNull(invitations.usedBy)))
        .returning({ id: invitations.id });
      if (claimed.length === 0) {
        throw createError({
          statusCode: 409,
          message: 'This invite code was just used. Please request a new one.',
        });
      }
    }

    return settledFirstUser;
  });

  // Notify the inviter when their code was redeemed. Sits outside
  // the transaction so a notification glitch doesn't roll back a
  // genuine signup.
  // The inviter FK is `createdBy` — `generatedBy` doesn't exist on
  // the invitations row, so this notify never fired (finding L4).
  if (validInvite && validInvite.createdBy) {
    void notify(
      validInvite.createdBy,
      'invite_redeemed',
      {
        inviteeUsername: body.username,
        inviteCode: validInvite.code,
      },
      '/invites',
    );
  }

  // If first user, close registration by default. Outside the
  // transaction because `setSetting` writes to a different table
  // and Redis; bundling it would unnecessarily widen the locked
  // window. A failure here doesn't roll back the new admin user —
  // the operator can flip the switch in /admin/settings.
  if (finalIsFirstUser) {
    await setRegistrationOpen(false);
  }

  // Set user session using nuxt-auth-utils.
  //
  // `theme: null` is not a missing value, it is the value: a member who has
  // never chosen follows the site default, and keeps following it when the
  // owner changes it. Writing `'dark'` here is what used to make the
  // site-default setting inert — it recorded a choice nobody made, and nothing
  // downstream could tell it apart from one. Language keeps its schema default
  // ('en'), which has no equivalent site-wide setting to defer to.
  // Registration opens a session like a login does, and a history that starts
  // at the second visit reads as if the first one is missing.
  void recordLogin(event, {
    userId,
    username: body.username,
    method: 'password',
    outcome: 'success',
  });

  await setUserSession(event, {
    user: {
      id: userId,
      username: body.username,
      passkey,
      isAdmin: finalIsFirstUser,
      isModerator: false,
      isOwner: finalIsFirstUser,
      // L'époque de session en cours, comparée à chaque requête par
      // `requireUserSession`. Voir `users.session_epoch`.
      sessionEpoch: 0,
      uploaded: starterUpload,
      downloaded: 0,
      bonusPoints: 0,
      theme: null,
      language: 'en',
    },
    loggedInAt: Date.now(),
  });

  // Open the fresh-auth window, exactly as `login.post.ts` does and at the same
  // point — after the session exists, keyed on the real h3 session id rather
  // than the session data object, which has no `id` (finding H1).
  //
  // Why registration counts. The window's job, at all eight `requireFreshAuth`
  // call sites, is to refuse a STOLEN session cookie: it asks for something a
  // thief does not have, namely the credential, supplied recently. A session
  // minted by the registration request itself is the one session that cannot
  // have been stolen yet — it is the same age as a session minted by a login,
  // and login stamps it.
  //
  // It is worth being precise about what registration does and does not prove,
  // because the tempting phrasing is wrong. Registration does NOT prove
  // knowledge of an existing credential — there is nothing to check against; it
  // ESTABLISHES the credential. That is a different thing, and for this window
  // it is a stronger one: the holder did not merely demonstrate the password,
  // they chose it, seconds ago, in this request.
  //
  // Without this, the founding account — which is the owner, and the account
  // most likely to want an owner-gated route immediately — is told to
  // "re-authenticate" by a session created moments earlier from the very
  // credential it is being asked to re-supply. The only way out is to log out
  // and back in, which proves nothing the registration did not.
  await markFreshAuth(await getSessionId(event));

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
