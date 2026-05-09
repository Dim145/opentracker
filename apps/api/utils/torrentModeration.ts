/**
 * Helpers shared by the torrent moderation endpoints.
 *
 * Two responsibilities live here so the route handlers stay thin:
 *
 *   1. `userCanBypassModeration(user)` — single source of truth for
 *      the bypass rule (admin / moderator / role flag). Used both at
 *      upload time (skip the queue entirely) and at edit time
 *      (don't auto-revert to pending when staff edits an accepted
 *      row).
 *
 *   2. `transitionStatus(...)` — atomic transition: stamp the new
 *      status on the torrents row + insert a corresponding row in
 *      `torrent_moderation_messages` so the discussion thread always
 *      mirrors the action history. The moderator's note travels with
 *      the action; if the body is empty (e.g. a no-comment approve)
 *      we still log a row with `is_system = true`.
 */
import { db, schema } from '@trackarr/db';
import { and, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

export type ModerationStatus =
  | 'pending'
  | 'accepted'
  | 'changes_requested'
  | 'rejected';

export const MODERATION_STATUSES: readonly ModerationStatus[] = [
  'pending',
  'accepted',
  'changes_requested',
  'rejected',
];

/**
 * True if the given user can publish without moderation review.
 *   - admins and moderators always can
 *   - members carry the bypass via any attached role's
 *     `canUploadWithoutModeration` flag
 */
export async function userCanBypassModeration(user: {
  id: string;
  isAdmin?: boolean | null;
  isModerator?: boolean | null;
}): Promise<boolean> {
  if (user.isAdmin || user.isModerator) return true;

  const rows = await db
    .select({ canBypass: schema.roles.canUploadWithoutModeration })
    .from(schema.userRoles)
    .innerJoin(schema.roles, eq(schema.userRoles.roleId, schema.roles.id))
    .where(eq(schema.userRoles.userId, user.id));

  return rows.some((r) => r.canBypass === true);
}

/**
 * Apply a status transition + post the matching message in a single
 * transaction. Returns the updated torrent row.
 *
 * @param torrentId    PK of the row to transition
 * @param nextStatus   target status
 * @param actorId      user performing the transition (FK users.id).
 *                     `null` for system transitions (auto-revert on
 *                     edit when the editor was unauthenticated for
 *                     some reason — should not normally happen).
 * @param body         message body. Required for transitions to
 *                     `changes_requested` and `rejected`; optional
 *                     for `accepted`. The caller is responsible for
 *                     enforcing the requirement.
 * @param isSystem     pass `true` for transitions emitted by the
 *                     server itself (e.g. "Resubmitted for review"
 *                     when an edit reverts to pending).
 */
export async function transitionStatus(opts: {
  torrentId: string;
  nextStatus: ModerationStatus;
  actorId: string | null;
  body: string | null;
  isSystem?: boolean;
}) {
  const { torrentId, nextStatus, actorId, body, isSystem = false } = opts;
  const now = new Date();

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.torrents)
      .set({
        moderationStatus: nextStatus,
        moderatedById: actorId,
        moderatedAt: now,
      })
      .where(eq(schema.torrents.id, torrentId))
      .returning();

    if (!updated) {
      throw createError({ statusCode: 404, message: 'Torrent not found' });
    }

    // Always log a row so the conversation timeline doubles as the
    // status-change history. An empty body becomes a one-line system
    // note instead of an opaque jump in the audit trail.
    const fallbackBody = body ?? defaultMessageFor(nextStatus);
    await tx.insert(schema.torrentModerationMessages).values({
      id: randomUUID(),
      torrentId,
      authorId: actorId,
      body: fallbackBody,
      isSystem: isSystem || body === null,
      statusChange: nextStatus,
      createdAt: now,
    });

    return updated;
  });
}

/**
 * Append a free-form chat message to the discussion (no status
 * change). Used by the uploader to ask for clarification or by a
 * moderator to leave a note that doesn't gate the row.
 */
export async function postMessage(opts: {
  torrentId: string;
  authorId: string;
  body: string;
}) {
  const id = randomUUID();
  const now = new Date();
  const [row] = await db
    .insert(schema.torrentModerationMessages)
    .values({
      id,
      torrentId: opts.torrentId,
      authorId: opts.authorId,
      body: opts.body,
      isSystem: false,
      statusChange: null,
      createdAt: now,
    })
    .returning();
  return row;
}

/**
 * True if the given user may read/write the moderation thread of the
 * torrent: the uploader of the row, or any staff member.
 */
export function canAccessModerationThread(opts: {
  torrent: { uploaderId: string | null };
  user: { id: string; isAdmin?: boolean | null; isModerator?: boolean | null };
}): boolean {
  if (opts.user.isAdmin || opts.user.isModerator) return true;
  return opts.torrent.uploaderId === opts.user.id;
}

function defaultMessageFor(status: ModerationStatus): string {
  switch (status) {
    case 'accepted':
      return 'Approved.';
    case 'changes_requested':
      return 'Changes requested.';
    case 'rejected':
      return 'Rejected.';
    case 'pending':
      return 'Returned to the queue.';
  }
}

// Re-export the table reference under a shorter alias so callers
// don't have to repeat `schema.torrents.moderationStatus` everywhere.
export const moderationStatusCol = schema.torrents.moderationStatus;
export { schema };
// Re-exported helper so callers needing to bulk-filter by a few
// statuses don't have to import drizzle directly.
export { and, inArray };
