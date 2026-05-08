/**
 * POST /api/invites
 * Generate a new invitation code, decrementing the caller's
 * `invitesRemaining` counter atomically.
 *
 * Hardening: the previous flow read invitesRemaining and then wrote
 * back in parallel. A user with `invitesRemaining=1` could fire N
 * concurrent requests, each saw 1, and N invitations were created
 * while the counter went to negative. Replace with a conditional
 * UPDATE that decrements only when the counter is still > 0; if 0
 * rows update, refuse the request and skip the invite insert.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql, and, gt } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'crypto';
import { isInviteEnabled } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const enabled = await isInviteEnabled();
  if (!enabled) {
    throw createError({
      statusCode: 403,
      message: 'Invitation system is currently disabled',
    });
  }

  // Atomic decrement: returns the row only when the counter was
  // strictly positive. Equivalent to a CAS check — eliminates the
  // TOCTOU window where two concurrent requests both read "1".
  const [reserved] = await db
    .update(schema.users)
    .set({ invitesRemaining: sql`${schema.users.invitesRemaining} - 1` })
    .where(
      and(eq(schema.users.id, user.id), gt(schema.users.invitesRemaining, 0))
    )
    .returning({ invitesRemaining: schema.users.invitesRemaining });

  if (!reserved) {
    throw createError({ statusCode: 403, message: 'No invites remaining' });
  }

  // From here we own the slot — failures below revert the counter.
  const code = randomBytes(16).toString('hex').toUpperCase();
  let invite: typeof schema.invitations.$inferSelect | undefined;
  try {
    [invite] = await db
      .insert(schema.invitations)
      .values({
        id: randomUUID(),
        code,
        createdBy: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      })
      .returning();
  } catch (err) {
    // Refund the slot we reserved so the user isn't penalised for our
    // failure (e.g. unique-constraint collision on the random code).
    await db
      .update(schema.users)
      .set({ invitesRemaining: sql`${schema.users.invitesRemaining} + 1` })
      .where(eq(schema.users.id, user.id));
    throw err;
  }

  return { success: true, invite };
});
