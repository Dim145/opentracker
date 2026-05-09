/**
 * POST /api/me/2fa/passkey/register-challenge
 *
 * Phase 1 of WebAuthn registration. Generates the
 * `PublicKeyCredentialCreationOptions` payload that the browser
 * passes to `navigator.credentials.create`. We exclude any
 * already-registered credential ids so the user can't accidentally
 * re-enrol the same authenticator twice. Challenge is cached in Redis
 * for 5 min and validated on the verify step.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import {
  rpID,
  rpOrigin,
  RP_NAME,
  setRegistrationChallenge,
} from '~~/utils/webauthn';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);

  const [user, existing] = await Promise.all([
    db.query.users.findFirst({
      where: eq(schema.users.id, session.user.id),
      columns: { id: true, username: true },
    }),
    db.query.webauthnCredentials.findMany({
      where: eq(schema.webauthnCredentials.userId, session.user.id),
      columns: { credentialId: true, transports: true },
    }),
  ]);
  if (!user) throw createError({ statusCode: 401, message: 'Unknown user' });

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpID(event),
    // The user id WebAuthn ties the credential to. We use the
    // server's UUID so the value is opaque to the client; the
    // username is only carried for display in the authenticator's
    // own UI.
    userID: new TextEncoder().encode(user.id),
    userName: user.username,
    userDisplayName: user.username,
    // Discourage password-equivalent replay: tell the authenticator
    // we want a strong attestation and a user-verifying ceremony
    // (PIN / biometric / device unlock). `preferred` lets the
    // browser fall back gracefully on platforms that don't have one.
    authenticatorSelection: {
      userVerification: 'preferred',
      residentKey: 'preferred',
      requireResidentKey: false,
    },
    // Don't burn the user's second authenticator slot on a duplicate.
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports
        ? (c.transports.split(',').filter(Boolean) as any[])
        : undefined,
    })),
    // No attestation: we don't try to identify the device model. It
    // adds privacy concerns and most browsers strip the cert chain
    // anyway. The challenge alone proves possession.
    attestationType: 'none',
  });

  await setRegistrationChallenge(user.id, options.challenge);

  return options;
});
