/**
 * PUT /api/mod/anti-cheat/flags/bulk
 *
 * Apply the same verdict (+ optional note) to a batch of flag ids
 * in a single round-trip. Sibling to `[id].put.ts` — same
 * idempotent stamping behaviour (reviewed_at, reviewed_by_id),
 * just over an array of rows.
 *
 * The batch is processed in one UPDATE … WHERE id IN (...) so the
 * stamp instant is identical across rows, which keeps the audit
 * trail readable ("these N flags were dispatched in the same
 * triage pass").
 *
 * Refuses to operate on > 200 rows to bound the impact of a fat-
 * fingered "select all" on a huge backlog. The page UI caps at the
 * current paginated slice anyway.
 */
import { db, schema } from '@trackarr/db';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';

const MAX_IDS = 200;

const bulkSchema = z.object({
  flagIds: z
    .array(z.string().regex(/^[a-f0-9]{32}$/))
    .min(1)
    .max(MAX_IDS),
  verdict: z.string().min(1).max(40),
  note: z.string().max(500).nullable().optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireModeratorSession(event);

  const body = await readBody(event);
  const data = bulkSchema.parse(body);

  // De-dupe ids client-side. The same row showing up twice in the
  // request is a no-op for the UPDATE but cleans up `updated.length`
  // accounting downstream.
  const ids = Array.from(new Set(data.flagIds));

  const updated = await db
    .update(schema.anticheatFlags)
    .set({
      reviewedAt: new Date(),
      reviewedById: user.id,
      reviewVerdict: data.verdict,
      reviewNote: data.note ?? null,
    })
    .where(inArray(schema.anticheatFlags.id, ids))
    .returning({ id: schema.anticheatFlags.id });

  return {
    updated: updated.length,
    ids: updated.map((u) => u.id),
  };
});
