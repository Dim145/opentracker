/**
 * POST /api/admin/owner/transfer — hand this instance to another admin.
 *
 * The escape hatch that makes ownership safe to have at all. Without it, an
 * owner who loses their password leaves the instance permanently unable to
 * federate, install a font, or allow raw CSS — and the only remedy is an UPDATE
 * against production.
 *
 * Owner-gated (obviously) and fresh-auth gated (less obviously): this is the
 * single highest-impact grant in the application, since it hands over every
 * decision reserved to the owner in one call. `role.put` already requires fresh
 * auth for the same reason, and a borrowed-but-stale admin session must not be
 * able to give the instance away.
 *
 * The recipient's eligibility is checked inside `transferOwnership`, under an
 * advisory lock, together with the read of the current owner — see there for
 * why both have to happen in the same transaction.
 */
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { requireOwnerSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { transferOwnership } from '~~/utils/owner';
import { notify } from '~~/utils/notify';

const bodySchema = z.object({ userId: z.string().uuid() }).strict();

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireOwnerSession(event);
  await requireFreshAuth(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const result = await transferOwnership(actor.id, body.userId);
  if (!result.ok) {
    throw createError({ statusCode: 400, message: result.reason });
  }

  // The new owner has to find out, and not by discovering a button works. This
  // is the one notification in the application that tells somebody they are now
  // responsible for the instance.
  const [heir] = await db
    .select({ username: schema.users.username })
    .from(schema.users)
    .where(eq(schema.users.id, body.userId))
    .limit(1);
  void notify(body.userId, 'staff_status_changed', {
    before: { isOwner: false },
    after: { isOwner: true },
    byUsername: actor.username,
  });

  return { ok: true, newOwner: heir?.username ?? null };
});
