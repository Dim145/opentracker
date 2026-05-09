/**
 * PATCH /api/admin/bonus-events/:id
 *
 * Update mutable fields of a bonus event. The route validates that
 * the resulting window doesn't overlap any *other* enabled row (the
 * row being edited is excluded from the check, otherwise it'd always
 * conflict with itself).
 *
 * Body is partial — anything omitted keeps its current value.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod/v4';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import {
  DOWNLOAD_MULTIPLIER_MAX,
  DOWNLOAD_MULTIPLIER_MIN,
  hasOverlap,
  syncActiveSnapshot,
  UPLOAD_MULTIPLIER_MAX,
  UPLOAD_MULTIPLIER_MIN,
} from '~~/utils/bonusEvents';

const bodySchema = z
  .object({
    title: z.string().min(1).max(120).optional(),
    description: z.string().max(500).nullish(),
    longDescription: z.string().max(2000).nullish(),
    downloadMultiplier: z
      .number()
      .int()
      .min(DOWNLOAD_MULTIPLIER_MIN)
      .max(DOWNLOAD_MULTIPLIER_MAX)
      .optional(),
    uploadMultiplier: z
      .number()
      .int()
      .min(UPLOAD_MULTIPLIER_MIN)
      .max(UPLOAD_MULTIPLIER_MAX)
      .optional(),
    startsAt: z.iso.datetime().optional(),
    endsAt: z.iso.datetime().optional(),
    enabled: z.boolean().optional(),
  })
  .refine(
    (b) =>
      !b.startsAt || !b.endsAt || new Date(b.endsAt) > new Date(b.startsAt),
    { message: 'endsAt must be after startsAt' }
  );

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) {
    throw createError({ statusCode: 400, message: 'Missing id' });
  }
  const body = await validateBody(event, bodySchema);

  const existing = await db.query.bonusEvents.findFirst({
    where: eq(bonusEvents.id, id),
  });
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Event not found' });
  }

  // Compute the prospective window. We always check against the
  // post-update values so an admin can't sneak past the overlap
  // guard by tweaking one bound at a time.
  const newStartsAt = body.startsAt ? new Date(body.startsAt) : existing.startsAt;
  const newEndsAt = body.endsAt ? new Date(body.endsAt) : existing.endsAt;
  const newEnabled = body.enabled ?? existing.enabled;

  if (newEnabled && (await hasOverlap(newStartsAt, newEndsAt, id))) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      message:
        'Another enabled bonus event overlaps this time window. Disable the conflicting one or pick a different window.',
    });
  }

  const [updated] = await db
    .update(bonusEvents)
    .set({
      ...(body.title !== undefined && { title: body.title }),
      ...(body.description !== undefined && { description: body.description }),
      ...(body.longDescription !== undefined && {
        longDescription: body.longDescription,
      }),
      ...(body.downloadMultiplier !== undefined && {
        downloadMultiplier: body.downloadMultiplier,
      }),
      ...(body.uploadMultiplier !== undefined && {
        uploadMultiplier: body.uploadMultiplier,
      }),
      ...(body.startsAt !== undefined && { startsAt: newStartsAt }),
      ...(body.endsAt !== undefined && { endsAt: newEndsAt }),
      ...(body.enabled !== undefined && { enabled: newEnabled }),
      updatedAt: new Date(),
    })
    .where(eq(bonusEvents.id, id))
    .returning();

  await syncActiveSnapshot();

  return { event: updated };
});
