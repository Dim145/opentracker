/**
 * DELETE /api/federation/identities/:id  — authenticated.
 * Removes one of the caller's linked identities. Idempotent.
 */
import { and, eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing id' });

  await db
    .delete(schema.federatedIdentities)
    .where(
      and(
        eq(schema.federatedIdentities.id, id),
        eq(schema.federatedIdentities.localUserId, session.user.id),
      ),
    );

  return { ok: true };
});
