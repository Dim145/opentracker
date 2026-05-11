/**
 * POST /api/me/2fa/recovery-codes/regenerate
 *
 * Burn the existing recovery code batch and mint a fresh one. Same
 * sensitivity as `disable`: requires the fresh-auth window AND a
 * live TOTP code (gate A + C). The new cleartext codes are returned
 * exactly once.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  isFreshAuth,
  RECOVERY_CODE_COUNT,
  verifyTotp,
} from '~~/utils/twoFactor';
import { validateBody } from '~~/utils/schemas';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'A 6-digit TOTP code is required'),
});

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const body = await validateBody(event, bodySchema);

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
    columns: { totpSecret: true, totpEnabled: true },
  });
  if (!row?.totpEnabled || !row.totpSecret) {
    throw createError({
      statusCode: 409,
      message: 'TOTP is not enabled.',
    });
  }
  if (!(await verifyTotp(body.code, row.totpSecret))) {
    throw createError({ statusCode: 400, message: 'Invalid TOTP code.' });
  }

  const codes = generateRecoveryCodes(RECOVERY_CODE_COUNT);
  await db.transaction(async (tx) => {
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

  void notify(
    session.user.id,
    'recovery_codes_regenerated',
    null,
    '/settings',
  );

  return { recoveryCodes: codes };
});
