/**
 * GET /api/mod/users/:id/logins — the same history, for moderation.
 *
 * The question this exists for is account sharing, which on an invite-only
 * tracker is the offence that matters most and the one there was no evidence
 * for. Several successful logins from different address hashes on the same day
 * is what it looks like.
 *
 * Same daily-salt limit as the member-facing view, and the same consequence:
 * the comparison is meaningful inside a day and meaningless across weeks. A
 * moderator drawing a conclusion from two hashes a month apart would be
 * drawing it from noise, so the page says so and the count below is scoped to
 * one day rather than to the whole page.
 *
 * Moderator, not admin: this is triage, and it sits beside the anti-cheat queue
 * those same people already work.
 */
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { uuidSchema, validateParam, validateQuery } from '~~/utils/schemas';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const userId = validateParam(event, 'id', uuidSchema);
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
    .where(eq(schema.loginEvents.userId, userId))
    .orderBy(desc(schema.loginEvents.createdAt))
    .limit(limit);

  // Distinct address hashes on the most recent day present — the number a
  // moderator is actually after, computed here so the "same day only" rule
  // lives in one place rather than in every reader's head.
  const newest = items[0]?.createdAt;
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const sameDay = newest ? items.filter((i) => day(i.createdAt) === day(newest)) : [];
  const distinctAddressesToday = new Set(
    sameDay.map((i) => i.ipHash).filter(Boolean)
  ).size;

  return { items, distinctAddressesToday };
});
