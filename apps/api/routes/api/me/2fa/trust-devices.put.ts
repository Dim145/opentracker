/**
 * PUT /api/me/2fa/trust-devices
 *
 * Flip the user's "remember this browser" preference. Disabling the
 * feature also wipes every existing trusted-device row so a previously
 * saved cookie immediately stops working — no surprise persistence.
 *
 * Body: `{ enabled: boolean }`
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { revokeAllForUser } from '~~/utils/trustedDevices';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z.object({ enabled: z.boolean() });

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event);
  const body = await validateBody(event, bodySchema);

  await db
    .update(schema.users)
    .set({ trustDevicesEnabled: body.enabled })
    .where(eq(schema.users.id, session.user.id));

  // Disabling the toggle should be immediate — wipe stored rows so a
  // pre-existing trusted-device cookie can't keep skipping the 2FA
  // check. Re-enabling later starts a fresh table; the user has to
  // log in fully once before a new cookie is issued.
  if (!body.enabled) {
    await revokeAllForUser(session.user.id);
  }

  return { enabled: body.enabled };
});
