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
import { and, eq, sql } from 'drizzle-orm';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
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

  const isExpired =
    invite.expiresAt !== null && invite.expiresAt.getTime() <= Date.now();

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.invitations)
      .where(eq(schema.invitations.id, invite.id));
    if (!isExpired) {
      // Refund — the slot was reserved at create-time, this gives it
      // back so the user isn't penalised for changing their mind.
      await tx
        .update(schema.users)
        .set({
          invitesRemaining: sql`${schema.users.invitesRemaining} + 1`,
        })
        .where(eq(schema.users.id, user.id));
    }
  });

  return { success: true, refunded: !isExpired };
});
