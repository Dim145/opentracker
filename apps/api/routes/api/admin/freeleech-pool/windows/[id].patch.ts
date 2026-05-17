/**
 * PATCH /api/admin/freeleech-pool/windows/:id — toggle / relabel.
 *
 * Keep the surface narrow: only `enabled` and `label` are mutable
 * post-creation. Changing the temporal bounds is a delete + create
 * to avoid silent shifts that would be invisible to contributors.
 */
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';

const bodySchema = z
  .object({
    enabled: z.boolean().optional(),
    label: z.string().max(60).nullish(),
  })
  .strict();

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }
  const body = await validateBody(event, bodySchema);

  const update: Record<string, unknown> = {};
  if (body.enabled !== undefined) update.enabled = body.enabled;
  if (body.label !== undefined) update.label = body.label ?? null;
  if (Object.keys(update).length === 0) {
    return { window: null };
  }

  const [updated] = await db
    .update(schema.freeleechPoolWindows)
    .set(update)
    .where(eq(schema.freeleechPoolWindows.id, id))
    .returning();
  if (!updated) {
    throw createError({ statusCode: 404, message: 'Window not found' });
  }
  return { window: updated };
});
