/**
 * GET /api/me/2fa/sessions
 *
 * Lists every active trusted-device row for the current user. Used by
 * the settings page to render the "remembered browsers" table with a
 * per-row revoke button.
 */
import { db, schema } from '@trackarr/db';
import { and, desc, eq, gt } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);

  const rows = await db.query.trustedDevices.findMany({
    where: and(
      eq(schema.trustedDevices.userId, session.user.id),
      gt(schema.trustedDevices.expiresAt, new Date())
    ),
    columns: {
      id: true,
      label: true,
      createdAt: true,
      expiresAt: true,
      lastUsedAt: true,
    },
    orderBy: [desc(schema.trustedDevices.lastUsedAt)],
  });

  return { devices: rows };
});
