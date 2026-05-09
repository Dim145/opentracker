/**
 * DELETE /api/admin/invites/:id
 *
 * Admin override for striking any invitation from the registry,
 * regardless of who created it. Useful for cleaning up codes that
 * leaked, abandoned spam, or recovering quotas after a botched
 * invite cycle.
 *
 * Behaviour mirrors the user-side delete with one twist:
 *   - Code never used and not yet expired → refund the *creator's*
 *     `invitesRemaining`. The author is the one who was charged at
 *     `POST /api/invites` time, so they get the slot back.
 *   - Code never used but already expired → no refund (the window
 *     has closed; admin clean-up of stale rows is housekeeping, not
 *     a way to recycle long-dead slots).
 *   - Code already used → row is removed but no refund and no
 *     downstream account changes (the recipient keeps their account;
 *     this is just registry hygiene).
 *
 * The deletion + counter touch happen in a single transaction so a
 * partial failure doesn't desynchronise the counter from the row.
 */
import { db, schema } from '@trackarr/db';
import { eq, sql } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);

  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }

  const invite = await db.query.invitations.findFirst({
    where: eq(schema.invitations.id, id),
  });
  if (!invite) {
    throw createError({ statusCode: 404, message: 'Invite not found' });
  }

  const isExpired =
    invite.expiresAt !== null && invite.expiresAt.getTime() <= Date.now();
  const wasUsed = !!invite.usedBy;
  const shouldRefund = !wasUsed && !isExpired;

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.invitations)
      .where(eq(schema.invitations.id, invite.id));
    if (shouldRefund) {
      await tx
        .update(schema.users)
        .set({
          invitesRemaining: sql`${schema.users.invitesRemaining} + 1`,
        })
        .where(eq(schema.users.id, invite.createdBy));
    }
  });

  return {
    success: true,
    refunded: shouldRefund,
    wasUsed,
  };
});
