/**
 * POST /api/me/2fa/totp/enable
 *
 * Phase 2 of the TOTP enrolment flow. Confirms the user has actually
 * scanned the QR by validating a 6-digit code, then flips
 * `totp_enabled = true` and atomically generates the recovery code
 * batch. The cleartext codes are returned exactly once for the UI to
 * show — only their sha256 hashes are persisted.
 *
 * Body: `{ code: '123456' }`.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  markFreshAuth,
  RECOVERY_CODE_COUNT,
  verifyTotp,
} from '~~/utils/twoFactor';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const body = await validateBody(event, bodySchema);

  const row = await db.query.users.findFirst({
    where: eq(schema.users.id, session.user.id),
    columns: { id: true, totpSecret: true, totpEnabled: true },
  });
  if (!row?.totpSecret) {
    throw createError({
      statusCode: 400,
      message: 'No pending TOTP secret. Call /setup first.',
    });
  }
  if (row.totpEnabled) {
    throw createError({
      statusCode: 409,
      message: 'TOTP is already enabled.',
    });
  }
  if (!(await verifyTotp(body.code, row.totpSecret))) {
    throw createError({
      statusCode: 400,
      message: 'Invalid code. Make sure your phone clock is in sync.',
    });
  }

  // Generate recovery codes inside the same transaction as the flip
  // so we never end up with TOTP enabled but no fallback codes if the
  // process dies mid-flight.
  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.transaction(async (tx) => {
    await tx
      .update(schema.users)
      .set({ totpEnabled: true })
      .where(eq(schema.users.id, session.user.id));
    // Wipe any stale codes from a previous enrolment cycle before
    // inserting the new batch — protects against the case where the
    // user disabled TOTP, kept the old codes, and is now re-enabling.
    await tx
      .delete(schema.recoveryCodes)
      .where(eq(schema.recoveryCodes.userId, session.user.id));
    await tx.insert(schema.recoveryCodes).values(
      codes.map((code) => ({
        id: randomUUID(),
        userId: session.user.id,
        codeHash: hashRecoveryCode(code),
      }))
    );
  });

  // The user just typed a valid TOTP code, that counts as a fresh
  // auth — let them perform other sensitive ops (e.g. add a passkey)
  // for the next 10 minutes without retyping anything.
  if (session.id) {
    await markFreshAuth(String(session.id));
  }

  void notify(session.user.id, 'totp_enabled', null, '/settings');

  return {
    enabled: true,
    recoveryCodes: codes,
  };
});
