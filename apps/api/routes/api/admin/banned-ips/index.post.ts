/**
 * POST /api/admin/banned-ips
 *
 * Manually ban an IP. Idempotent — banning an already-banned IP just
 * updates the reason instead of erroring (matches the upsert behaviour
 * of `users/[id]/ban.post.ts` so the two paths can't fight each
 * other).
 *
 * Body:
 *   ip      — IPv4 dotted or IPv6 hex/compressed; validated via
 *             node:net `isIP()` so we accept any RFC-valid form.
 *   reason  — short note shown in the admin list. Optional; defaults
 *             to "Manual ban by admin" if omitted.
 *
 * Auth: moderator+ (matches the rest of the admin/* tree).
 */
import { isIP } from 'node:net';
import { db, schema } from '@trackarr/db';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { z } from 'zod';

const bodySchema = z.object({
  ip: z
    .string()
    .trim()
    .min(2)
    .max(45) // IPv6 max textual length
    .refine((v) => isIP(v) !== 0, {
      message: 'Not a valid IPv4 or IPv6 address',
    }),
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must be 500 characters or fewer')
    .optional()
    .nullable(),
});

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await readValidatedBody(event, bodySchema.parse);

  const reason = body.reason?.trim() || 'Manual ban by admin';

  const [row] = await db
    .insert(schema.bannedIps)
    .values({
      ip: body.ip,
      reason,
    })
    .onConflictDoUpdate({
      target: schema.bannedIps.ip,
      set: { reason },
    })
    .returning();

  return {
    success: true,
    ip: row!.ip,
    reason: row!.reason,
    createdAt: row!.createdAt,
    automatic: false,
  };
});
