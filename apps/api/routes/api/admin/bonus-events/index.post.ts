/**
 * POST /api/admin/bonus-events
 *
 * Create a new bonus event. We refuse to insert if an `enabled = true`
 * row already covers any sub-interval of the requested window — the
 * product rule is "at most one window active at a time", so the
 * conflict check happens before we touch the table.
 */
import { db } from '@trackarr/db';
import { bonusEvents } from '@trackarr/db/schema';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import {
  DOWNLOAD_MULTIPLIER_MAX,
  DOWNLOAD_MULTIPLIER_MIN,
  hasOverlap,
  lockBonusEventsForWrite,
  syncActiveSnapshot,
  UPLOAD_MULTIPLIER_MAX,
  UPLOAD_MULTIPLIER_MIN,
} from '~~/utils/bonusEvents';

const bodySchema = z
  .object({
    title: z.string().min(1).max(120),
    description: z.string().max(500).nullish(),
    longDescription: z.string().max(2000).nullish(),
    downloadMultiplier: z
      .number()
      .int()
      .min(DOWNLOAD_MULTIPLIER_MIN)
      .max(DOWNLOAD_MULTIPLIER_MAX),
    uploadMultiplier: z
      .number()
      .int()
      .min(UPLOAD_MULTIPLIER_MIN)
      .max(UPLOAD_MULTIPLIER_MAX),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    enabled: z.boolean().default(true),
  })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'endsAt must be after startsAt',
  });

export default defineEventHandler(async (event) => {
  const session = await requireAdminSession(event);
  const body = await validateBody(event, bodySchema);

  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);

  // Overlap check + insert run inside the same transaction, gated by
  // a Postgres advisory lock so two admins POSTing concurrent windows
  // serialise. Without the lock, both calls could pass `hasOverlap`
  // and both inserts would commit, violating the "at most one
  // window active at a time" product rule.
  const id = randomUUID();
  const row = await db.transaction(async (tx) => {
    await lockBonusEventsForWrite(tx);

    if (body.enabled && (await hasOverlap(startsAt, endsAt, undefined, tx))) {
      throw createError({
        statusCode: 409,
        statusMessage: 'Conflict',
        message:
          'Another enabled bonus event overlaps this time window. Disable the conflicting one or pick a different window.',
      });
    }

    const [inserted] = await tx
      .insert(bonusEvents)
      .values({
        id,
        title: body.title,
        description: body.description ?? null,
        longDescription: body.longDescription ?? null,
        downloadMultiplier: body.downloadMultiplier,
        uploadMultiplier: body.uploadMultiplier,
        startsAt,
        endsAt,
        enabled: body.enabled,
        createdById: session.user.id,
      })
      .returning();
    return inserted;
  });

  // Re-resolve the active window snapshot — the new row may itself
  // be the new "active now" event if the operator created a window
  // that brackets the present moment.
  await syncActiveSnapshot();

  return { event: row };
});
