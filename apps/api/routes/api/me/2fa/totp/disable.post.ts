/**
 * POST /api/me/2fa/totp/disable
 *
 * Sensitive operation: gated by the A+C pattern.
 *   A — the session must be in the 10-minute fresh-auth window (a
 *       recent full SRP + 2FA login). Stops a stolen idle session
 *       from disarming the second factor.
 *   C — the user must also pass a fresh 2FA challenge as part of
 *       this request (TOTP code or recovery code). Stops a session
 *       hijack the moment after a legitimate login.
 *
 * Body: `{ code: '123456' }` (TOTP) or `{ recoveryCode: 'XXXX-XXXXXX' }`.
 * Either is accepted. We refuse if neither is present.
 *
 * On success: clears `totp_secret` + `totp_enabled` and wipes any
 * remaining recovery codes (they pin to TOTP).
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  hashRecoveryCode,
  isFreshAuth,
  verifyTotp,
} from '~~/utils/twoFactor';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z
  .object({
    code: z.string().regex(/^\d{6}$/).optional(),
    recoveryCode: z
      .string()
      .regex(/^[A-Z2-9]{4}-?[A-Z2-9]{6}$/i)
      .optional(),
  })
  .refine((b) => b.code || b.recoveryCode, {
    message: 'Either `code` or `recoveryCode` is required.',
  });

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const body = await validateBody(event, bodySchema);

  // Gate A — fresh auth window.
  const sid = String(session.id ?? '');
  if (!sid || !(await isFreshAuth(sid))) {
    throw createError({
      statusCode: 401,
      message:
        'Re-authenticate first. Sensitive changes require a fresh login (≤ 10 min ago).',
    });
  }

  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, session.user.id),
    columns: { id: true, totpSecret: true, totpEnabled: true },
  });
  if (!row?.totpEnabled || !row.totpSecret) {
    throw createError({
      statusCode: 409,
      message: 'TOTP is not enabled.',
    });
  }

  // Gate C — fresh 2FA challenge. Either a live TOTP code or one of
  // the unused recovery codes counts. We never accept a passkey here
  // because TOTP is the thing being disarmed; the user proving they
  // hold the secret is the cleanest confirmation.
  let consumedRecoveryId: string | null = null;
  if (body.code) {
    if (!(await verifyTotp(body.code, row.totpSecret))) {
      throw createError({ statusCode: 400, message: 'Invalid TOTP code.' });
    }
  } else if (body.recoveryCode) {
    const hash = hashRecoveryCode(body.recoveryCode);
    const match = await db.query.recoveryCodes.findFirst({
      where: and(
        eq(schema.recoveryCodes.userId, session.user.id),
        eq(schema.recoveryCodes.codeHash, hash),
        isNull(schema.recoveryCodes.usedAt)
      ),
      columns: { id: true },
    });
    if (!match) {
      throw createError({
        statusCode: 400,
        message: 'Invalid or already-used recovery code.',
      });
    }
    consumedRecoveryId = match.id;
  }

  // Wipe TOTP state + the entire recovery code batch atomically.
  await db.transaction(async (tx) => {
    if (consumedRecoveryId) {
      await tx
        .update(schema.recoveryCodes)
        .set({ usedAt: new Date() })
        .where(eq(schema.recoveryCodes.id, consumedRecoveryId));
    }
    await tx
      .update(schema.users)
      .set({ totpSecret: null, totpEnabled: false })
      .where(eq(schema.users.id, session.user.id));
    await tx
      .delete(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.userId, session.user.id));
  });

  return { enabled: false };
});
