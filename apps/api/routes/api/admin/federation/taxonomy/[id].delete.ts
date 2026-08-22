/**
 * DELETE /api/admin/federation/taxonomy/:id
 *
 * Drop a mapping. The foreign slug reverts to matching only by conventional
 * equality (usually: nothing), and to raw display, on the next read.
 */
import { requireAdminSession } from '~~/utils/adminAuth';
import { clearRemoteCategoryMapping } from '~~/utils/federation/categoryMap';

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const id = getRouterParam(event, 'id');
  if (!id) throw createError({ statusCode: 400, message: 'Missing mapping id' });

  const removed = await clearRemoteCategoryMapping(id);
  if (!removed) {
    throw createError({ statusCode: 404, message: 'Mapping not found' });
  }
  return { ok: true, removed: id };
});
