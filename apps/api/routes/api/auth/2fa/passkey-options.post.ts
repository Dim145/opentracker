/**
 * POST /api/auth/2fa/passkey-options
 *
 * Produce a `PublicKeyCredentialRequestOptions` for the browser to
 * call `navigator.credentials.get` against. We pin the allowed
 * credentials to the ones registered by the user identified by the
 * challenge token — that way one user can't poke another user's
 * passkeys.
 *
 * The challenge is cached in Redis keyed on the same challenge token
 * so the verify step can match it.
 *
 * Body: `{ challengeToken: string }`
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { z } from 'zod';
import { redis } from '../../../../utils/server';
import { rpID, setAuthChallenge } from '~~/utils/webauthn';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({
  challengeToken: z.string().min(16).max(128),
});

export default defineEventHandler(async (event) => {
  const body = await validateBody(event, bodySchema);

  // Peek at the challenge token without consuming it — we need the
  // userId to filter allowCredentials, but the verify endpoint will
  // consume the token for real on success.
  const userId = await redis.get(`auth:2fa-challenge:${body.challengeToken}`);
  if (!userId) {
    throw createError({
      statusCode: 401,
      message: 'Challenge expired or invalid. Restart the login.',
    });
  }

  const passkeys = await db.query.webauthnCredentials.findMany({
    where: eq(schema.webauthnCredentials.userId, userId),
    columns: { credentialId: true, transports: true },
  });
  if (passkeys.length === 0) {
    throw createError({
      statusCode: 400,
      message: 'No passkeys registered for this account.',
    });
  }

  const options = await generateAuthenticationOptions({
    rpID: rpID(event),
    userVerification: 'preferred',
    allowCredentials: passkeys.map((p) => ({
      id: p.credentialId,
      transports: p.transports
        ? (p.transports.split(',').filter(Boolean) as any[])
        : undefined,
    })),
  });

  await setAuthChallenge(body.challengeToken, options.challenge);

  return options;
});
