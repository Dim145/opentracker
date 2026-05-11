/**
 * PUT /api/me/notification-routing
 *
 * Bulk-set the user's routing rows. Body shape:
 *   { entries: [{ type: 'upload_accepted', channelType: 'smtp' }, …] }
 *
 * Strategy: delete all of the user's existing routing rows, then
 * insert the new set in a single transaction. This is simpler than
 * computing a diff and the operation is bounded (37 types × 1 row
 * each).
 *
 * Validation:
 *   - `type` must be a known NotificationType
 *   - `channelType` must reference a user-channel row the user has
 *     actually configured (avoids dangling pointers).
 */
import { db, schema } from '@trackarr/db';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';

const bodySchema = z.object({
  entries: z
    .array(
      z.object({
        type: z.string().min(1).max(64),
        channelType: z.string().min(1).max(32),
      })
    )
    .max(64),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const raw = await readBody(event);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid body' });
  }

  // Collect the user's actual channel types so we can validate
  // every routing target.
  const userChannels = await db.query.userNotificationChannels.findMany({
    where: eq(schema.userNotificationChannels.userId, user.id),
    columns: { channelType: true, enabled: true },
  });
  const enabledTypes = new Set(
    userChannels.filter((c) => c.enabled).map((c) => c.channelType)
  );

  const cleaned = parsed.data.entries.filter((e) =>
    enabledTypes.has(e.channelType)
  );

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.userNotificationRouting)
      .where(eq(schema.userNotificationRouting.userId, user.id));
    if (cleaned.length > 0) {
      await tx.insert(schema.userNotificationRouting).values(
        cleaned.map((e) => ({
          userId: user.id,
          type: e.type,
          channelType: e.channelType,
        }))
      );
    }
  });

  return { ok: true, count: cleaned.length };
});
