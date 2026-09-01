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
import { and, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { uuidSchema, validateParam, validateQuery } from '~~/utils/schemas';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Replace the stored address hash with a label that only means something inside
 * this response.
 *
 * The hash is `sha256(secret:day:ip)` truncated, and it is the SAME value in the
 * member's own view and in the moderator's view of that member — so a moderator
 * who suspects an account is being shared with somebody they can reach could
 * sign in from that address, read their own hash, and compare. The hash was
 * meant to make an address unrecoverable; handing the same value to two readers
 * made it a confirmation oracle for a day.
 *
 * An ordinal keeps the only property either view claims — telling two addresses
 * apart within one day — and gives up the only property neither needs, which is
 * comparability with anybody else's copy.
 */
function labelAddresses<T extends { ipHash: string | null; createdAt: Date }>(
  rows: T[]
): Array<Omit<T, 'ipHash'> & { address: string | null }> {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const { ipHash, ...rest } = row;
    if (!ipHash) return { ...rest, address: null } as Omit<T, 'ipHash'> & { address: null };
    // Keyed on hash AND day, because the salt rotates daily: the same address
    // is a different hash tomorrow, and pretending otherwise would invent a
    // continuity the data does not have.
    //
    // Numbered WITHIN the day, not across the response. A single counter over
    // the whole page meant one home address on five different days rendered as
    // `#1 #2 #3 #4 #5` — so the ordinary case, one place over many days, looked
    // exactly like five different places, on the one screen whose entire job is
    // spotting somebody else signing in as you. Restarting each day also makes
    // the "only comparable within one day" caveat something the numbers say for
    // themselves rather than something a footnote has to teach.
    const day = row.createdAt.toISOString().slice(0, 10);
    const key = `${ipHash}:${day}`;
    let ordinal = seen.get(key);
    if (ordinal === undefined) {
      let next = 1;
      for (const k of seen.keys()) if (k.endsWith(`:${day}`)) next += 1;
      ordinal = next;
      seen.set(key, ordinal);
    }
    return { ...rest, address: `#${ordinal}` } as Omit<T, 'ipHash'> & { address: string };
  });
}

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

  /**
   * Distinct address hashes among the SUCCESSFUL sign-ins of the most recent day.
   *
   * Two corrections, and each of them was a way to make a moderator wrong about
   * account sharing — the one offence this figure is used to judge.
   *
   * **Successes only.** A failed attempt records the target's id and the
   * CALLER's address, and it needs no password: an unauthenticated stranger
   * could send twenty bad logins against one account from twenty addresses and
   * the moderator would read "20 different addresses". The file's own docstring
   * says "several successful logins", and now the query does too.
   *
   * **Counted in SQL, not on the page.** Taken from the returned rows, the
   * figure was bounded by the page size: a member signing in fifty times from
   * one address pushed the others off the first thirty rows and the count read
   * `1`. So the subject could suppress it at will, and a moderator changing the
   * page size changed the number.
   */
  const [today] = await db
    .select({
      day: sql<string>`to_char(${schema.loginEvents.createdAt}, 'YYYY-MM-DD')`,
      addresses: sql<number>`count(distinct ${schema.loginEvents.ipHash})::int`,
      logins: sql<number>`count(*)::int`,
    })
    .from(schema.loginEvents)
    .where(
      and(
        eq(schema.loginEvents.userId, userId),
        eq(schema.loginEvents.outcome, 'success')
      )
    )
    .groupBy(sql`to_char(${schema.loginEvents.createdAt}, 'YYYY-MM-DD')`)
    .orderBy(desc(sql`to_char(${schema.loginEvents.createdAt}, 'YYYY-MM-DD')`))
    .limit(1);

  return {
    items: labelAddresses(items),
    distinctAddressesToday: today?.addresses ?? 0,
    /** Which day that count is about, since it is the newest day WITH a success. */
    distinctAddressesDay: today?.day ?? null,
    successfulLoginsThatDay: today?.logins ?? 0,
  };
});
