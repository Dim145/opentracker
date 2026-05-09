/**
 * GET /api/me/2fa/status
 *
 * Snapshot of the user's MFA configuration for the settings page.
 * Returns:
 *
 *   - `totpEnabled`              — true once TOTP is fully enrolled
 *   - `passkeys`                 — list of registered WebAuthn
 *                                  credentials (id, name, dates) so
 *                                  the page can render the table
 *   - `recoveryCodesRemaining`   — count of unused recovery codes
 *                                  (for the "regenerate?" prompt)
 *   - `trustDevicesEnabled`      — user-controlled toggle for the
 *                                  "remember this browser" feature
 *   - `freshAuth`                — true if the user is currently in
 *                                  the 10-minute fresh-auth window;
 *                                  the FE uses this to pre-warn before
 *                                  starting a sensitive flow
 */
import { db, schema } from '@trackarr/db';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { count } from 'drizzle-orm';
import { isFreshAuth } from '~~/utils/twoFactor';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);

  const [user, passkeys, [{ value: recoveryCodesRemaining } = { value: 0 }]] =
    await Promise.all([
      db.query.users.findFirst({
        where: eq(schema.users.id, session.user.id),
        columns: { totpEnabled: true, trustDevicesEnabled: true },
      }),
      db.query.webauthnCredentials.findMany({
        where: eq(schema.webauthnCredentials.userId, session.user.id),
        columns: {
          id: true,
          name: true,
          createdAt: true,
          lastUsedAt: true,
        },
        orderBy: [asc(schema.webauthnCredentials.createdAt)],
      }),
      db
        .select({ value: count() })
        .from(schema.recoveryCodes)
        .where(
          and(
            eq(schema.recoveryCodes.userId, session.user.id),
            isNull(schema.recoveryCodes.usedAt)
          )
        ),
    ]);

  const sid = String(session.id ?? '');
  const fresh = sid ? await isFreshAuth(sid) : false;

  return {
    totpEnabled: user?.totpEnabled ?? false,
    trustDevicesEnabled: user?.trustDevicesEnabled ?? false,
    passkeys,
    recoveryCodesRemaining: Number(recoveryCodesRemaining),
    freshAuth: fresh,
  };
});
