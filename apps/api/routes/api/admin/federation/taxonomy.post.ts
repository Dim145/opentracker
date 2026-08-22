/**
 * POST /api/admin/federation/taxonomy  { remoteSlug, localCategoryId }
 *
 * Declare (or re-point) the local category a partner's slug resolves to.
 * Idempotent on the slug — sending it again just moves the target.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { setRemoteCategoryMapping } from '~~/utils/federation/categoryMap';

const bodySchema = z.object({
  remoteSlug: z.string().trim().min(1).max(128),
  localCategoryId: z.string().min(1),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  const body = bodySchema.parse(await readBody(event));

  // The target must be a real local category — a mapping to a category that no
  // longer exists would resolve to nothing and never widen a filter.
  const category = await db.query.categories.findFirst({
    where: eq(schema.categories.id, body.localCategoryId),
    columns: { id: true },
  });
  if (!category) {
    throw createError({ statusCode: 404, statusMessage: 'Unknown category' });
  }

  const id = await setRemoteCategoryMapping(
    body.remoteSlug,
    body.localCategoryId,
    user.id,
  );
  return { id };
});
