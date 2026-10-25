import { eq } from 'drizzle-orm';
import { createHash } from 'crypto';
import { db } from '@trackarr/db';
import { users, bannedIps, webauthnCredentials } from '@trackarr/db/schema';
import { validateBody, loginSchema } from '~~/utils/schemas';
import { redis } from '~~/utils/server';
import {
  rateLimit,
  RATE_LIMITS,
  assertAccountNotLocked,
  recordAccountFailure,
  clearAccountFailures,
} from '~~/utils/rateLimit';
import { UNKNOWN_ACCOUNT_CHALLENGE } from '~~/utils/loginChallenge';
import { mintChallengeToken, markFreshAuth } from '~~/utils/twoFactor';
import { consumeTrustedDevice } from '~~/utils/trustedDevices';
import {
  readKnownDevice,
  recordKnownDeviceFailure,
  issueKnownDevice,
} from '~~/utils/knownDevices';
import { notify } from '~~/utils/notify';
import { liftExpiredBan } from '~~/utils/banExpiry';
import { decryptSecret, encryptSecretRequired, needsRewrite } from '~~/utils/credentialSecrets';
import { recordLogin } from '~~/utils/account/loginLog';

/**
 * How long refusing credentials takes, at least.
 *
 * The answer to a username with no account and to a wrong proof is the same
 * status and message, but not the same work: the second reads the account,
 * decrypts its verifier and hashes, and was a few milliseconds slower — which
 * enumerates members as surely as a different message, given enough samples.
 * Both now end no sooner than this after the request arrived. Well above what
 * either path costs; unnoticeable after a 600 000-iteration PBKDF2 in the
 * browser.
 */
const REFUSAL_FLOOR_MS = 300;

/**
 * POST /api/auth/login
 * Authenticate user with Zero Knowledge proof
 * User proves knowledge of password without sending it
 */
export default defineEventHandler(async (event) => {
  const arrivedAt = Date.now();
  // 10 tries per 5 minutes per address (an IPv6 /64), WITHOUT the progressive
  // blacklist — see `RATE_LIMITS.signin` for why a sign-in failure must not
  // shut a whole address out of the site. Guessing spread over many addresses
  // meets the per-account counter instead.
  await rateLimit(event, RATE_LIMITS.signin);
  const body = await validateBody(event, loginSchema);
  // A browser that has already signed in to this account answers to its own
  // failure counter instead of the account's: whoever fails on purpose from
  // elsewhere can hold the account shut to new devices, not to the member's
  // own. See `utils/knownDevices`.
  const knownDevice = await readKnownDevice(event, body.username);
  if (!knownDevice) await assertAccountNotLocked(body.username);

  // Consumed atomically: two concurrent requests with the same challenge used
  // to both read it before either deleted it.
  const userId = await redis.getdel(`login:${body.challenge}`);
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Invalid or expired challenge',
    });
  }

  // A username with no account takes the same exit as a wrong proof — same
  // status, same message, same failure count. See `utils/loginChallenge`.
  const rejectCredentials = async () => {
    if (knownDevice) await recordKnownDeviceFailure(knownDevice);
    else await recordAccountFailure(body.username);
    const wait = REFUSAL_FLOOR_MS - (Date.now() - arrivedAt);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    return createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  };
  if (userId === UNKNOWN_ACCOUNT_CHALLENGE) throw await rejectCredentials();

  // Find user by ID from challenge
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
    .then((r) => r[0]);

  if (!user || user.username !== body.username) throw await rejectCredentials();

  // ── Verify ZKE proof FIRST ──────────────────────────────────
  // Username/account-status checks (banned, etc.) deliberately run
  // *after* the proof verification. Otherwise an attacker who knows
  // a username could probe the system for a 403 vs 401 to enumerate
  // banned accounts without ever solving the SRP challenge. With the
  // proof gate on top, those branches are unreachable to anyone
  // without the password.
  if (!user.authVerifier) throw await rejectCredentials();

  // The verifier is encrypted at rest. `decryptSecret` returns a legacy
  // plaintext value unchanged, so accounts created before the rollout keep
  // working; it returns null when the ciphertext fails authentication, and
  // we fail closed on that rather than compare against a corrupted row.
  const storedVerifier = decryptSecret(user.authVerifier);
  if (!storedVerifier) {
    throw createError({
      statusCode: 401,
      message: 'Invalid credentials',
    });
  }

  const expectedProof = createHash('sha256')
    .update(storedVerifier + body.challenge)
    .digest('hex');

  if (!secureCompare(body.proof, expectedProof)) {
    // Recorded before the throw: the member and staff read failed attempts
    // here, whatever the per-account counter makes of them.
    void recordLogin(event, {
      userId: user.id,
      username: user.username,
      method: 'password',
      outcome: 'failed',
    });
    throw await rejectCredentials();
  }
  // Not after a known device's success: the account's failures came from
  // somewhere else, and wiping them would hand whoever made them a fresh ten.
  if (!knownDevice) await clearAccountFailures(body.username);

  // Lazy migration: a proven-correct login is the safe moment to write the
  // verifier back under the current key — whether it was legacy plaintext or
  // only readable through CREDENTIAL_ENCRYPTION_KEY_PREVIOUS. Fire-and-forget:
  // a failure here must never cost the user their login, the next one retries.
  // The known-device cookie issued below is bound to the column as it WILL be.
  let storedAuthVerifier = user.authVerifier;
  if (needsRewrite(user.authVerifier)) {
    storedAuthVerifier = encryptSecretRequired(storedVerifier);
    void db
      .update(users)
      .set({ authVerifier: storedAuthVerifier })
      .where(eq(users.id, user.id))
      .catch(() => {});
  }

  // ── Account & IP bans ───────────────────────────────────────
  // Both gates run *after* the proof check (see above) so a
  // non-credentialed probe can never distinguish a banned from a
  // healthy account.
  //
  // `liftExpiredBan` is the lazy half of the ban-expiry system —
  // if `bannedUntil` has passed it clears the flag inline so the
  // user can log in even if the 5-minute cron hasn't ticked yet.
  const stillBanned = await liftExpiredBan(user);
  if (stillBanned) {
    throw createError({
      statusCode: 403,
      message: 'Your account has been banned',
    });
  }

  // getClientIP honors TRUST_PROXY so a client behind an untrusted
  // proxy can't forge X-Forwarded-For to bypass the ban.
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

  // Detect login from a new IP — emitted *before* the row is
  // updated so we can compare against the previous value. A null
  // previous IP (fresh account) doesn't fire the notification:
  // the very first login isn't "new", it's just first.
  const previousIp = user.lastIp;
  const currentIp = clientIp !== 'unknown' ? clientIp : null;
  if (previousIp && currentIp && previousIp !== currentIp) {
    void notify(
      user.id,
      'login_new_ip',
      { previousIp, currentIp },
      '/settings',
    );
  }

  // Update last seen and IP
  await db
    .update(users)
    .set({
      lastSeen: new Date(),
      lastIp: currentIp,
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
      language: user.language,
      passkey: user.passkey,
      isAdmin: user.isAdmin,
      isModerator: user.isModerator,
      isOwner: user.isOwner,
      // L'époque de session en cours, comparée à chaque requête par
      // `requireUserSession`. Voir `users.session_epoch`.
      sessionEpoch: user.sessionEpoch ?? 0,
      uploaded: user.uploaded,
      downloaded: user.downloaded,
      bonusPoints: user.bonusPoints,
    },
    loggedInAt: Date.now(),
  });
  issueKnownDevice(event, {
    userId: user.id,
    sessionEpoch: user.sessionEpoch,
    authVerifier: storedAuthVerifier,
  });

  // `trusted-device` when the second factor was skipped by a remembered
  // browser, `password` otherwise. The distinction is the point: a member
  // reading their own history should be able to see which sessions never met
  // their second factor.
  void recordLogin(event, {
    userId: user.id,
    username: user.username,
    method: (event.context as { trustedDeviceUsed?: boolean }).trustedDeviceUsed
      ? 'trusted-device'
      : 'password',
    outcome: 'success',
  });

  // Stamp the fresh-auth window even on no-2FA logins so the same
  // settings flow ("change my password" etc.) works either way.
  // Key on the real h3 session id (getSessionId), not the session
  // *data* object — `getUserSession` returns only `{ user }`, which
  // has no `id`, so the old `session.id` was always undefined and
  // the fresh-auth window never opened (finding H1).
  await markFreshAuth(await getSessionId(event));

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
