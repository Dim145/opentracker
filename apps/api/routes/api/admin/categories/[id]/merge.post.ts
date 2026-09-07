import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';
import { auditDetail } from '~~/utils/audit';

/**
 * POST /api/admin/categories/:id/merge — fondre une catégorie dans une autre.
 *
 * Un import laisse « Films » et « Movies », « Jeux » et « Games » : deux
 * facettes pour une seule chose, et un catalogue qui compte double. Tout ce
 * qui pointait la source pointe la cible — torrents, sous-catégories,
 * recherches enregistrées, demandes, motifs des règles d'envoi, table de
 * correspondance fédérée — puis la source disparaît. Une transaction : pas de
 * catalogue à moitié déplacé.
 */
const bodySchema = z.object({ into: z.string().trim().min(1).max(128) });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Category ID is required' });
  const { into } = await validateBody(event, bodySchema);
  if (into === id) throw createError({ statusCode: 400, message: 'A category cannot be merged into itself' });

  const [source, target] = await Promise.all([
    db.query.categories.findFirst({ where: eq(schema.categories.id, id) }),
    db.query.categories.findFirst({ where: eq(schema.categories.id, into) }),
  ]);
  if (!source || !target) throw createError({ statusCode: 404, message: 'Category not found' });
  if (target.parentId === id) {
    throw createError({ statusCode: 400, message: 'The target is a child of the source; merge the other way round' });
  }

  const moved = await db.transaction(async (tx) => {
    const torrents = await tx
      .update(schema.torrents)
      .set({ categoryId: into })
      .where(eq(schema.torrents.categoryId, id))
      .returning({ id: schema.torrents.id });
    await tx.update(schema.categories).set({ parentId: into }).where(eq(schema.categories.parentId, id));
    await tx.update(schema.savedSearches).set({ categoryId: into }).where(eq(schema.savedSearches.categoryId, id));
    await tx.update(schema.uploadRequests).set({ categoryId: into }).where(eq(schema.uploadRequests.categoryId, id));
    await tx
      .update(schema.uploadRuleCategoryPatterns)
      .set({ categoryId: into })
      .where(eq(schema.uploadRuleCategoryPatterns.categoryId, id));
    await tx
      .update(schema.remoteCategoryMap)
      .set({ localCategoryId: into })
      .where(eq(schema.remoteCategoryMap.localCategoryId, id));
    await tx.delete(schema.categories).where(eq(schema.categories.id, id));
    return torrents.length;
  });

  invalidateAdultCategoryCache();
  auditDetail(event, {
    action: 'categories.merge',
    targetType: 'category',
    targetId: id,
    changes: { from: source.name, into: target.name, torrentsMoved: moved },
  });
  return { success: true, moved };
});
