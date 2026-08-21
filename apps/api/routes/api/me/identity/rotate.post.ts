/**
 * POST /api/me/identity/rotate — the member's recourse for a leaked key.
 *
 * Retires their current identifier, issues a new one, and publishes the
 * withdrawal so every partner drops what was proven with the old key and
 * refuses it thereafter.
 *
 * Nothing here can un-leak a key. Whoever holds the old file can still sign
 * with it, forever, and any document they already made still verifies —
 * signatures cannot be reached back into. What a rotation removes is the
 * instance's endorsement, which was the half that made the key worth anything
 * to anybody else.
 *
 * The cost is real and the member has to be told it: their proven links
 * everywhere fall, and each has to be re-proven with a fresh export. That is
 * not a rough edge to be smoothed later — carrying the links forward would
 * hand them to whoever stole the file, which is the precise case this exists
 * for.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { rotateUserKey } from '~~/utils/federation/userIdentity';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.auth);

  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { id: true },
  });
  if (!me) throw createError({ statusCode: 404, message: 'No such member' });

  const { previous, did } = await rotateUserKey(me.id);

  return {
    ok: true,
    did,
    previous,
    /**
     * The withdrawal is published by the record sweep, not here: it belongs in
     * the same stream as everything else this instance says, and a partner
     * learns of it the same way it learns of anything.
     */
    published: false,
  };
});
