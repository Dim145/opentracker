/**
 * DELETE /api/admin/themes/:id
 *
 * The interesting part is not the delete, it is everything holding a reference to
 * the slug. `users.theme` is free-form text with no foreign key — deliberately,
 * so a member's stored preference survives a theme they never asked to lose —
 * which means nothing in the database would notice the dangling value. A member
 * left holding a deleted slug gets a page with no theme block at all.
 *
 * So the delete puts them back to following the site default first, and resets
 * either half of `system` mode that pointed here, all in one transaction. Leaving one of those
 * two out is the difference between removing a theme and breaking the site for
 * whoever was using it.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { bumpThemeVersion, releaseThemeReferences } from '~~/utils/themes';

const paramsSchema = z.object({ id: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const { id } = paramsSchema.parse(getRouterParams(event));

  const [theme] = await db
    .select({ slug: schema.themes.slug })
    .from(schema.themes)
    .where(eq(schema.themes.id, id))
    .limit(1);
  if (!theme) {
    throw createError({ statusCode: 404, message: 'No such theme' });
  }

  // Members holding this slug go back to following the site default — NULL —
  // rather than being pinned to whatever the default happens to be today. The
  // difference shows up later: pinned, they never move again; following, the
  // owner's next change reaches them. Neither is a choice they made, so the
  // weaker claim is the right one.
  let moved = 0;
  await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.users)
      .set({ theme: null })
      .where(eq(schema.users.theme, theme.slug))
      .returning({ id: schema.users.id });
    moved = res.length;
    await tx.delete(schema.themes).where(eq(schema.themes.id, id));
  });

  // Settings live behind a cache with its own invalidation, so they are written
  // outside the transaction — a rolled-back delete with a reset mapping would be
  // a worse inconsistency than the reverse, and the reverse self-heals on the
  // next save.
  await releaseThemeReferences(theme.slug);

  await bumpThemeVersion();
  return { ok: true, membersMoved: moved };
});
