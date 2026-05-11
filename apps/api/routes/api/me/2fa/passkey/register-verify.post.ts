/**
 * POST /api/me/2fa/passkey/register-verify
 *
 * Phase 2 of WebAuthn registration. Body carries the
 * `RegistrationResponseJSON` produced by the browser after a
 * `navigator.credentials.create` call. We validate the cryptographic
 * proof, persist the credential, and return its row id + name.
 *
 * Body: `{ name: string, response: RegistrationResponseJSON }`
 */
import { db, schema } from '@trackarr/db';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  clearRegistrationChallenge,
  getRegistrationChallenge,
  rpID,
  rpOrigin,
} from '~~/utils/webauthn';
import { markFreshAuth } from '~~/utils/twoFactor';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  name: z.string().min(1).max(64),
  // We don't tightly type the WebAuthn response object — the browser
  // shape is large and well-typed by @simplewebauthn/browser on the
  // FE side. Server-side we only feed it back into the verifier.
  response: z.any(),
});

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const body = await validateBody(event, bodySchema);

  const expected = await getRegistrationChallenge(session.user.id);
  if (!expected) {
    throw createError({
      statusCode: 400,
      message: 'No active registration challenge. Restart the flow.',
    });
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: expected,
      expectedOrigin: rpOrigin(event),
      expectedRPID: rpID(event),
      requireUserVerification: false,
    });
  } catch (err: any) {
    throw createError({
      statusCode: 400,
      message: `WebAuthn verification failed: ${err?.message || 'unknown'}`,
    });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw createError({ statusCode: 400, message: 'WebAuthn registration not verified.' });
  }

  const info = verification.registrationInfo;
  // simplewebauthn v11+ returns a `credential` sub-object; older
  // versions return the fields at the top level. Defensive read so
  // we don't break across upgrades.
  const credential =
    (info as any).credential ?? {
      id: (info as any).credentialID,
      publicKey: (info as any).credentialPublicKey,
      counter: (info as any).counter ?? 0,
    };

  const credentialId =
    typeof credential.id === 'string'
      ? credential.id
      : Buffer.from(credential.id).toString('base64url');
  const publicKeyB64 = Buffer.from(credential.publicKey).toString('base64');
  const transports = Array.isArray(body.response?.response?.transports)
    ? body.response.response.transports.join(',')
    : null;

  await db.insert(schema.webauthnCredentials).values({
    id: randomUUID(),
    userId: session.user.id,
    credentialId,
    publicKey: publicKeyB64,
    counter: Number(credential.counter ?? 0),
    transports,
    name: body.name.trim(),
  });

  await clearRegistrationChallenge(session.user.id);

  // Adding a passkey counts as a fresh-auth confirmation —
  // user-verifying ceremony just happened seconds ago.
  if (session.id) {
    await markFreshAuth(String(session.id));
  }

  void notify(
    session.user.id,
    'passkey_added',
    { passkeyName: body.name },
    '/settings',
  );

  return { name: body.name, credentialId };
});
