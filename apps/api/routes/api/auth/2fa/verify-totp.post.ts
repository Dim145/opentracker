/**
 * POST /api/auth/2fa/verify-totp
 *
 * Trade a 2FA challenge token + a TOTP code (or recovery code) for a
 * real session. Called by the login UI right after a successful SRP
 * step.
 *
 * Body: `{ challengeToken: string, code?: string, recoveryCode?: string }`
 */
import { db } from '@trackarr/db';
import { users, recoveryCodes } from '@trackarr/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  consumeChallengeToken,
  hashRecoveryCode,
  markFreshAuth,
  verifyTotp,
} from '~~/utils/twoFactor';
import { issueTrustedDevice } from '~~/utils/trustedDevices';
import { validateBody } from '~~/utils/schemas';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const bodySchema = z
  .object({
    challengeToken: z.string().min(16).max(128),
    code: z.string().regex(/^\d{6}$/).optional(),
    recoveryCode: z
      .string()
      .regex(/^[A-Z2-9]{4}-?[A-Z2-9]{6}$/i)
      .optional(),
  })
  .refine((b) => b.code || b.recoveryCode, {
    message: 'Either `code` or `recoveryCode` is required',
  });

export default defineEventHandler(async (event) => {
  // Same brute-force window as the SRP login. Even if the attacker
  // somehow got the challenge token, they still face the rate limit
  // on TOTP guesses — 1M codes / 5 tries / 5min ≈ infeasible.
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await validateBody(event, bodySchema);

  const userId = await consumeChallengeToken(body.challengeToken);
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Challenge expired or already used. Restart the login.',
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      username: true,
      displayName: true,
      theme: true,
      passkey: true,
      isAdmin: true,
      isModerator: true,
      uploaded: true,
      downloaded: true,
      totpSecret: true,
      totpEnabled: true,
      trustDevicesEnabled: true,
    },
  });
  if (!user) {
    throw createError({ statusCode: 401, message: 'User not found' });
  }

  // Branch: TOTP code or recovery code. We never accept both in the
  // same request — either is enough proof on its own.
  if (body.code) {
    if (!user.totpEnabled || !user.totpSecret) {
      throw createError({
        statusCode: 400,
        message: 'TOTP is not enabled for this account.',
      });
    }
    if (!(await verifyTotp(body.code, user.totpSecret))) {
      throw createError({ statusCode: 400, message: 'Invalid TOTP code.' });
    }
  } else if (body.recoveryCode) {
    const hash = hashRecoveryCode(body.recoveryCode);
    const match = await db.query.recoveryCodes.findFirst({
      where: and(
        eq(recoveryCodes.userId, user.id),
        eq(recoveryCodes.codeHash, hash),
        isNull(recoveryCodes.usedAt)
      ),
      columns: { id: true },
    });
    if (!match) {
      throw createError({
        statusCode: 400,
        message: 'Invalid or already-used recovery code.',
      });
    }
    await db
      .update(recoveryCodes)
      .set({ usedAt: new Date() })
      .where(eq(recoveryCodes.id, match.id));
  }

  // Open the session — same shape as the post-SRP path so the FE
  // doesn't need to know which way it came in.
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

  const session = await getUserSession(event);
  if (session?.id) await markFreshAuth(String(session.id));

  // Issue the trusted-device cookie if the user opted in. Best-effort
  // (a DB hiccup here would block the login otherwise — the user can
  // always set it on the next successful flow).
  if (user.trustDevicesEnabled) {
    try {
      const ua = (getHeader(event, 'user-agent') || '').slice(0, 120) || null;
      await issueTrustedDevice(event, user.id, ua);
    } catch (err) {
      console.warn('[auth] failed to issue trusted device cookie', err);
    }
  }

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
