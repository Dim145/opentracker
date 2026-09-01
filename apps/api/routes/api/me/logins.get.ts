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
    const key = `${ipHash}:${row.createdAt.toISOString().slice(0, 10)}`;
    let ordinal = seen.get(key);
    if (ordinal === undefined) {
      ordinal = seen.size + 1;
      seen.set(key, ordinal);
    }
    return { ...rest, address: `#${ordinal}` } as Omit<T, 'ipHash'> & { address: string };
  });
}

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

  return { items: labelAddresses(items) };
});
