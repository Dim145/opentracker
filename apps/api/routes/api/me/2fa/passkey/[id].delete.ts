/**
 * DELETE /api/me/2fa/passkey/[id]
 *
 * Remove a registered passkey. Sensitive: requires the fresh-auth
 * window. Idempotent — deleting an already-deleted id returns 404
 * but doesn't error the page.
 *
 * We do NOT block removing the last passkey when TOTP is enabled
 * (the user keeps a second factor). We DO block when TOTP is
 * disabled and this would leave the account with no 2FA at all
 * — a defensive guard against accidental lockouts. To strip MFA
 * completely, the user must disable TOTP first.
 */
import { db, schema } from '@trackarr/db';
import { and, eq } from 'drizzle-orm';
import { count } from 'drizzle-orm';
import { isFreshAuth } from '~~/utils/twoFactor';
import { notify } from '~~/utils/notify';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Passkey id required' });
  }

  const sid = String(session.id ?? '');
  if (!sid || !(await isFreshAuth(sid))) {
    throw createError({
      statusCode: 401,
      message:
        'Re-authenticate first. Sensitive changes require a fresh login (≤ 10 min ago).',
    });
  }

  // Confirm ownership before doing anything destructive — a
  // crafted DELETE for someone else's id should 404, not 200.
  const owner = await db.query.webauthnCredentials.findFirst({
    where: and(
      eq(schema.webauthnCredentials.id, id),
      eq(schema.webauthnCredentials.userId, session.user.id)
    ),
    columns: { id: true },
  });
  if (!owner) {
    throw createError({ statusCode: 404, message: 'Passkey not found' });
  }

  // Lockout guard: if TOTP isn't on AND this would remove the last
  // passkey, refuse. The user can disable TOTP first, accept the
  // "no 2FA" state explicitly, then come back.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, session.user.id),
    columns: { totpEnabled: true },
  });
  if (!me?.totpEnabled) {
    const [{ value: total } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.webauthnCredentials)
      .where(eq(schema.webauthnCredentials.userId, session.user.id));
    if (Number(total) <= 1) {
      throw createError({
        statusCode: 409,
        message:
          'Refusing to remove the last second factor. Enable TOTP first if you still want a 2FA path.',
      });
    }
  }

  await db
    .delete(schema.webauthnCredentials)
    .where(eq(schema.webauthnCredentials.id, id));

  void notify(session.user.id, 'passkey_removed', { passkeyId: id }, '/settings');

  return { deleted: id };
});
