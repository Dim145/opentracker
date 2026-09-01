/**
 * GET /api/me/logins — where this account has been used from.
 *
 * The member's own copy of the login history, so "was that me?" has an answer
 * that does not require asking staff. Includes failures: an attempt that did
 * not succeed is the one worth knowing about.
 *
 * The address is a daily-salted hash, so two rows can be compared for "same
 * place" only within one day. The page says so — a reader who assumes
 * otherwise would draw the wrong conclusion from two different-looking hashes
 * that are in fact the same address a week apart.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const { limit } = validateQuery(event, querySchema);

  const items = await db
    .select({
      id: schema.loginEvents.id,
      method: schema.loginEvents.method,
      outcome: schema.loginEvents.outcome,
      ipHash: schema.loginEvents.ipHash,
      userAgent: schema.loginEvents.userAgent,
      createdAt: schema.loginEvents.createdAt,
    })
    .from(schema.loginEvents)
    .where(eq(schema.loginEvents.userId, user.id))
    .orderBy(desc(schema.loginEvents.createdAt))
    .limit(limit);

  return { items };
});
