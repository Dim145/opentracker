import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAdminSession } from '~~/utils/adminAuth';
import { auditDetail } from '~~/utils/audit';

/**
 * DELETE /api/admin/search-misses — effacer une ligne, ou tout.
 *
 * Une recherche qu'on a traitée (la release est arrivée, ou n'existe pas)
 * sort de la liste ; sans corps, la liste repart de zéro.
 */
const bodySchema = z.object({ query: z.string().trim().min(1).max(200).optional() });

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const raw = await readBody(event).catch(() => ({}));
  const parsed = bodySchema.safeParse(raw ?? {});
  if (!parsed.success) throw createError({ statusCode: 400, message: 'query: 1 to 200 characters' });
  const body = parsed.data;
  const deleted = body.query
    ? await db.delete(schema.searchMisses).where(eq(schema.searchMisses.query, body.query.toLowerCase())).returning({ q: schema.searchMisses.query })
    : await db.delete(schema.searchMisses).returning({ q: schema.searchMisses.query });
  auditDetail(event, {
    action: 'search_misses.clear',
    targetType: 'search_misses',
    changes: { query: body.query ?? '*', deleted: deleted.length },
  });
  return { success: true, deleted: deleted.length };
});
