/**
 * POST /api/auth/2fa/passkey-verify
 *
 * Final step of a passkey-based login. Verifies the assertion the
 * browser produced from `navigator.credentials.get`, bumps the
 * authenticator's replay counter, opens the session, and consumes
 * the challenge token.
 *
 * Body: `{ challengeToken: string, response: AuthenticationResponseJSON }`
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import {
  clearAuthChallenge,
  getAuthChallenge,
  rpID,
  rpOrigin,
} from '~~/utils/webauthn';
import {
  consumeChallengeToken,
  markFreshAuth,
} from '~~/utils/twoFactor';
import { issueTrustedDevice } from '~~/utils/trustedDevices';
import { validateBody } from '~~/utils/schemas';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

const bodySchema = z.object({
  challengeToken: z.string().min(16).max(128),
  response: z.any(),
});

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.auth);
  const body = await validateBody(event, bodySchema);

  // Consuming the token here means a failed assertion still burns it
  // — the user has to restart the SRP step. Slightly more friction,
  // but it stops a network attacker from siphoning challenge tokens
  // and trying assertions one at a time.
  const userId = await consumeChallengeToken(body.challengeToken);
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Challenge expired or already used. Restart the login.',
    });
  }
  const expectedChallenge = await getAuthChallenge(body.challengeToken);
  if (!expectedChallenge) {
    throw createError({
      statusCode: 400,
      message: 'No active passkey challenge — call /passkey-options first.',
    });
  }

  // Look up the credential the browser selected. The id in
  // body.response.id is base64url; same encoding we stored at
  // registration time.
  const credId =
    typeof body.response?.id === 'string' ? body.response.id : '';
  if (!credId) {
    throw createError({ statusCode: 400, message: 'Missing credential id' });
  }
  const cred = await db.query.webauthnCredentials.findFirst({
    where: and(
      eq(schema.webauthnCredentials.userId, userId),
      eq(schema.webauthnCredentials.credentialId, credId)
    ),
  });
  if (!cred) {
    throw createError({ statusCode: 401, message: 'Unknown passkey' });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge,
      expectedOrigin: rpOrigin(event),
      expectedRPID: rpID(event),
      requireUserVerification: false,
      // simplewebauthn v11+ wants the credential as a structured arg.
      credential: {
        id: cred.credentialId,
        publicKey: Buffer.from(cred.publicKey, 'base64'),
        counter: Number(cred.counter ?? 0),
        transports: cred.transports
          ? (cred.transports.split(',').filter(Boolean) as any[])
          : undefined,
      },
    });
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      message: `Passkey verification failed: ${err?.message || 'unknown'}`,
    });
  }

  if (!verification.verified || !verification.authenticationInfo) {
    throw createError({ statusCode: 400, message: 'Passkey assertion not verified' });
  }

  // Bump replay counter + last-used stamp.
  await db
    .update(schema.webauthnCredentials)
    .set({
      counter: Number(verification.authenticationInfo.newCounter ?? 0),
      lastUsedAt: new Date(),
    })
    .where(eq(schema.webauthnCredentials.id, cred.id));

  await clearAuthChallenge(body.challengeToken);

  // Hydrate the session with the same shape as the SRP and TOTP paths.
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, userId),
    columns: {
      id: true,
      username: true,
      displayName: true,
      theme: true,
      language: true,
      passkey: true,
      isAdmin: true,
      isModerator: true,
      uploaded: true,
      downloaded: true,
      trustDevicesEnabled: true,
    },
  });
  if (!user) throw createError({ statusCode: 401, message: 'User not found' });

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
      uploaded: user.uploaded,
      downloaded: user.downloaded,
    },
    loggedInAt: Date.now(),
  });

  const session = await getUserSession(event);
  if (session?.id) await markFreshAuth(String(session.id));

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
