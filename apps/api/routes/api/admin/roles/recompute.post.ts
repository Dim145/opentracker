/**
 * POST /api/admin/roles/recompute
 *
 * Triggers a full sweep of the auto-role engine. Useful after seeding
 * a fresh stack or after editing several roles in bulk — the per-edit
 * fire-and-forget sweep on /api/admin/roles[/:id] handles the common
 * case but a manual button is still nice to have.
 *
 * Auth: admin. Rate-limited because the sweep iterates every
 * non-banned user (one stats query each).
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { reevaluateAllUsers } from '~~/utils/roleRules';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);

  const result = await reevaluateAllUsers();
  return { success: true, ...result };
});
