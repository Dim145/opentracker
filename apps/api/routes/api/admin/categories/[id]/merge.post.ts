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
const bodySchema = z.object({ into: z.string().uuid() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id || !z.string().uuid().safeParse(id).success) throw createError({ statusCode: 400, message: 'Category ID is required' });
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
  // Le drapeau adulte suit la catégorie : fondre une catégorie adulte dans une
  // catégorie ordinaire montrerait ses torrents à qui a coupé ce contenu.
  if (source.isAdult !== target.isAdult) {
    throw createError({ statusCode: 400, message: 'The adult flag differs between the two categories' });
  }
  // La cible ne descend pas de la source (à toute profondeur : sinon un cycle),
  // et une source qui a des enfants ne peut fondre que dans une racine, pour
  // que l'arbre garde ses deux niveaux — le listing ne déplie qu'un niveau.
  const children = await db.query.categories.findMany({ where: eq(schema.categories.parentId, id), columns: { id: true } });
  if (children.length > 0 && target.parentId) {
    throw createError({ statusCode: 400, message: 'A category with sub-categories can only be merged into a root category' });
  }
  // Toute la chaîne, jusqu'à la racine — un compteur de bonds laissait passer
  // un arbre plus profond que la limite. Le jeu des visités arrête un cycle
  // préexistant sans borne arbitraire.
  const walked = new Set<string>();
  for (let cursor = target.parentId; cursor && !walked.has(cursor); ) {
    if (cursor === id) throw createError({ statusCode: 400, message: 'The target descends from the source' });
    walked.add(cursor);
    const parent = await db.query.categories.findFirst({ where: eq(schema.categories.id, cursor), columns: { parentId: true } });
    cursor = parent?.parentId ?? null;
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
    // Un motif d'envoi par catégorie (clé primaire) : si la cible a déjà le
    // sien, il l'emporte et celui de la source part avec elle ; sinon il suit.
    const [targetPattern] = await tx
      .select({ categoryId: schema.uploadRuleCategoryPatterns.categoryId })
      .from(schema.uploadRuleCategoryPatterns)
      .where(eq(schema.uploadRuleCategoryPatterns.categoryId, into))
      .limit(1);
    if (targetPattern) {
      await tx.delete(schema.uploadRuleCategoryPatterns).where(eq(schema.uploadRuleCategoryPatterns.categoryId, id));
    } else {
      await tx
        .update(schema.uploadRuleCategoryPatterns)
        .set({ categoryId: into })
        .where(eq(schema.uploadRuleCategoryPatterns.categoryId, id));
    }
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
