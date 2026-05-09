/**
 * POST /api/me/2fa/totp/setup
 *
 * Phase 1 of the TOTP enrolment flow. Generates a fresh base32 secret,
 * stores it on the user row (but leaves `totp_enabled = false` until
 * the verify call lands), and returns the `otpauth://` URI plus a
 * data-URL SVG QR code the FE can <img src=…> directly.
 *
 * Idempotent: if the user already has a non-confirmed secret pending
 * we replace it. Once `totp_enabled = true`, this endpoint refuses —
 * the user must disable first to rotate the secret.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import QRCode from 'qrcode';
import {
  buildTotpUri,
  generateTotpSecret,
} from '~~/utils/twoFactor';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);

  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { id: true, username: true, totpEnabled: true },
  });
  if (!row) throw createError({ statusCode: 401, message: 'Unknown user' });
  if (row.totpEnabled) {
    throw createError({
      statusCode: 409,
      message:
        'TOTP is already enabled. Disable it first if you want to rotate the secret.',
    });
  }

  const secret = generateTotpSecret();
  const issuer = process.env.TRACKARR_NAME || 'Trackarr';
  const uri = buildTotpUri({ secret, username: row.username, issuer });

  // SVG keeps the response small and scales crisp on retina; the FE
  // can drop it straight into an <img src="data:image/svg+xml;..."/>.
  const qrSvg = await QRCode.toString(uri, {
    type: 'svg',
    margin: 1,
    width: 240,
  });
  const qrDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}`;

  await db
    .update(schema.users)
    .set({ totpSecret: secret })
    .where(eq(schema.users.id, user.id));

  return {
    secret, // exposed once so the FE can offer "manual entry" as a fallback
    uri,
    qrDataUrl,
  };
});
