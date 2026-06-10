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

  const wasUsed = !!invite.usedBy;

  // Admin keeps the "strike any row, used or not" power, so the DELETE
  // is unconditional — but the refund must fire at most once even if
  // two admins (or a double-fired request) hit the same unused invite.
  // Key the refund off the DELETE's RETURNING: only the request that
  // actually removed the row sees it, the concurrent losers get an
  // empty result and skip the `+1`. Used/expired rows are still deleted
  // (housekeeping) but never refunded (finding H3, admin variant).
  const refunded = await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(schema.invitations)
      .where(eq(schema.invitations.id, invite.id))
      .returning({
        usedBy: schema.invitations.usedBy,
        expiresAt: schema.invitations.expiresAt,
      });
    if (!deleted) {
      return false; // a concurrent request already removed it
    }
    const stillValid =
      deleted.expiresAt === null || deleted.expiresAt.getTime() > Date.now();
    const doRefund = !deleted.usedBy && stillValid;
    if (doRefund) {
      await tx
        .update(schema.users)
        .set({
          invitesRemaining: sql`${schema.users.invitesRemaining} + 1`,
        })
        .where(eq(schema.users.id, invite.createdBy));
    }
    return doRefund;
  });

  return {
    success: true,
    refunded,
    wasUsed,
  };
});
