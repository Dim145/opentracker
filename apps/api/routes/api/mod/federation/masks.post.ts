/**
 * POST /api/mod/federation/masks — hide a mirrored release locally.
 *
 * Body: { scope, value, reason? }. `scope` is one of record | infohash |
 * author; `value` is the record id, infohash, or author DID to hide. It takes
 * effect on the next read of every mirror surface — flat browse, grouped
 * catalogue, group detail, live search — without touching the peer or the
 * record. Reversible via DELETE.
 */
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { maskRemote, MASK_SCOPES } from '~~/utils/federation/remoteMask';

const bodySchema = z.object({
  scope: z.enum(MASK_SCOPES as unknown as [string, ...string[]]),
  value: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(500).optional().nullable(),
});

export default defineEventHandler(async (event) => {
  const session = await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  const id = await maskRemote(body.scope as never, body.value, {
    reason: body.reason ?? null,
    createdBy: session.user.id,
  });

  return { ok: true, id };
});
