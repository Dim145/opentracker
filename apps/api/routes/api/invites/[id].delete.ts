/**
 * DELETE /api/invites/:id
 *
 * Lets a user permanently drop one of their own pending or expired
 * invitation codes.
 *
 * Refund rules — kept intentionally simple so the user can predict
 * the outcome:
 *   - Code never used and not yet expired → refund `invitesRemaining`
 *     (the user "took back" an unused gift).
 *   - Code never used but already expired → no refund (the
 *     opportunity was lost when the window closed; otherwise an
 *     expiring code would just become an alternative way to recycle
 *     a slot indefinitely).
 *   - Code already used → refusal: we keep the row so the inviter's
 *     "Used by" lineage stays intact.
 *
 * The deletion + counter refund happen in a single transaction so a
 * crash between the two doesn't leave the counter desynchronised.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  const invite = await db.query.invitations.findFirst({
    where: and(
      eq(schema.invitations.id, id),
      eq(schema.invitations.createdBy, user.id)
    ),
  });
  if (!invite) {
    throw createError({ statusCode: 404, message: 'Invite not found' });
  }
  if (invite.usedBy) {
    throw createError({
      statusCode: 409,
      message: 'This code has already been used and cannot be deleted.',
    });
  }

  // Guarded delete + conditional refund, both inside the transaction.
  // The DELETE carries `used_by IS NULL` and we key the refund off
  // whether RETURNING actually gave us the row: only the first of N
  // concurrent deletes removes it, so the `+1` refund fires at most
  // once. Previously the delete was keyed on id alone and the refund
  // was unconditional, so a burst of parallel deletes of one unused
  // invite minted +N slots (finding H3). Expiry is re-derived from the
  // deleted row rather than a stale pre-read.
  const refunded = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(schema.invitations)
      .where(
        and(
          eq(schema.invitations.id, invite.id),
          isNull(schema.invitations.usedBy),
        ),
      )
      .returning({ expiresAt: schema.invitations.expiresAt });
    if (!deleted) {
      // Lost the race (already deleted) or the code was used between
      // the pre-read and here — keep the row's lineage, no refund.
      return false;
    }
    const stillValid =
      deleted.expiresAt === null || deleted.expiresAt.getTime() > Date.now();
    if (stillValid) {
      // Refund — the slot was reserved at create-time, this gives it
      // back so the user isn't penalised for changing their mind.
      await tx
        .update(schema.users)
        .set({
          invitesRemaining: sql`${schema.users.invitesRemaining} + 1`,
        })
        .where(eq(schema.users.id, user.id));
    }
    return stillValid;
  });

  return { success: true, refunded };
});
