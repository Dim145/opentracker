/**
 * PUT /api/admin/users/:id/role
 * Toggle isAdmin / isModerator flags on a user.
 *
 * Hardening:
 *   - Strict Zod body — `!!body.isAdmin` used to coerce strings, so
 *     `{isAdmin: "false"}` flipped the bit to true.
 *   - Last-admin guard — refuse to demote the only remaining admin
 *     (would lock the install out of admin recovery).
 *   - Self-demote guard — an admin can't strip their own admin bit
 *     mid-session; they must ask another admin.
 */
import { db, schema } from '@trackarr/db';
import { requireAdminSession, requireFreshAuth } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import { eq, and, ne, count } from 'drizzle-orm';
import { z } from 'zod';
import { notify } from '~~/utils/notify';
import { auditDetail } from '~~/utils/audit';

const paramsSchema = z.object({ id: z.string().uuid() });
const bodySchema = z
  .object({
    isAdmin: z.boolean(),
    isModerator: z.boolean(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  const { user: actor } = await requireAdminSession(event);
  // Privilege grants are the highest-impact admin action — require a
  // fresh login on top of the admin gate (finding L10).
  await requireFreshAuth(event);
  const { id } = paramsSchema.parse(getRouterParams(event));
  // Routed through validateBody so a Zod failure renders as a clean
  // 400 with a human message, not a wall of `unrecognized_keys` issue
  // objects. The frontend used to send the whole RegistryUser object
  // here and the operator saw a list of every column name.
  const body = await validateBody(event, bodySchema);

  const target = await db.query.users.findFirst({
    where: eq(schema.users.id, id),
    columns: {
      id: true,
      username: true,
      isAdmin: true,
      isModerator: true,
      isOwner: true,
    },
  });
  if (!target) {
    throw createError({ statusCode: 404, message: 'User not found' });
  }

  // The owner cannot be demoted by somebody else, and this is a security guard
  // rather than a courtesy.
  //
  // Ownership falls to the oldest eligible admin when the holder can no longer
  // act (see `utils/owner.ts`). If an admin could quietly clear the owner's
  // `is_admin`, that fallback becomes an escalation path: demote the owner,
  // ownership lands on the oldest remaining admin, and on a small staff that is
  // very often the person who just did it. No log entry says "seized", because
  // from the outside it is two ordinary role changes.
  //
  // The staff are not left without recourse over a rogue owner: banning still
  // moves ownership, and a ban is heavier, notified and attributed. What is
  // removed is only the quiet version.
  if (target.isOwner && !body.isAdmin) {
    throw createError({
      statusCode: 400,
      message:
        'The instance owner cannot be demoted. They must transfer ownership first.',
    });
  }

  // Self-demote guard — an admin can't lose their own admin bit via
  // this route. Forces a "two admin" workflow for demotions.
  if (actor.id === target.id && target.isAdmin && !body.isAdmin) {
    throw createError({
      statusCode: 400,
      message: 'You cannot remove your own admin status. Ask another admin.',
    });
  }

  // Last-admin guard — count *other* admins. Prevents an empty admin
  // pool that would block recovery short of a panic restore.
  if (target.isAdmin && !body.isAdmin) {
    const [{ value: otherAdmins } = { value: 0 }] = await db
      .select({ value: count() })
      .from(schema.users)
      .where(and(eq(schema.users.isAdmin, true), ne(schema.users.id, target.id)));
    if (otherAdmins === 0) {
      throw createError({
        statusCode: 400,
        message:
          'Cannot demote the last admin. Promote another user to admin first.',
      });
    }
  }

  // A privilege grant is the row an audit log exists for: it is how one
  // compromised account becomes several. Both flags, both directions.
  auditDetail(event, {
    action: 'user.role',
    targetType: 'user',
    targetId: target.id,
    targetLabel: target.username,
    changes: {
      isAdmin: { from: target.isAdmin, to: body.isAdmin },
      isModerator: { from: target.isModerator, to: body.isModerator },
    },
  });

  const [updated] = await db
    .update(schema.users)
    .set({
      isAdmin: body.isAdmin,
      isModerator: body.isModerator,
    })
    .where(eq(schema.users.id, id))
    .returning();

  // Bust the cached role so the staff gates observe the change
  // within the request, not after the 60 s TTL — and a demotion
  // takes effect immediately (finding M2).
  await invalidateRoleCache(id);

  // Notify the affected user when their staff status actually
  // changed in either direction. The payload carries both before
  // and after flags so the bell can render a precise label.
  const adminChanged = target.isAdmin !== body.isAdmin;
  const modChanged = target.isModerator !== body.isModerator;
  if (adminChanged || modChanged) {
    void notify(target.id, 'staff_status_changed', {
      before: { isAdmin: target.isAdmin, isModerator: target.isModerator },
      after: { isAdmin: body.isAdmin, isModerator: body.isModerator },
      actorUsername: actor.username,
    });
  }

  return updated;
});
