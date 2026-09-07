import { and, desc, eq, lt } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { validateParam, validateQuery, infoHashSchema } from '~~/utils/schemas';
import { assertVisibleTorrent } from '~~/utils/torrentListing';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/**
 * GET /api/torrents/:hash/comments — le fil, par pages.
 *
 * La fiche embarque la première page ; celle-ci sert les suivantes. Pagination
 * par CURSEUR (`before`, la date du plus ancien déjà affiché) et non par
 * décalage : un commentaire publié entre deux clics décale une pagination par
 * `OFFSET` et fait sauter une ligne ou la répéter. Un curseur ne bouge pas.
 *
 * Même visibilité que la fiche : un torrent en attente, retiré ou adulte
 * masqué répond 404 plutôt que d'ouvrir son fil.
 */
export const COMMENTS_PAGE_SIZE = 20;

const querySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(COMMENTS_PAGE_SIZE),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const hash = validateParam(event, 'hash', infoHashSchema).toLowerCase();
  const { before, limit } = validateQuery(event, querySchema);
  const torrent = await assertVisibleTorrent(hash, session.user);

  // Une ligne de plus que demandé : sa présence dit qu'il en reste, sans un
  // `count(*)` sur tout le fil à chaque page.
  const rows = await db.query.torrentComments.findMany({
    where: before
      ? and(eq(schema.torrentComments.torrentId, torrent.id), lt(schema.torrentComments.createdAt, new Date(before)))
      : eq(schema.torrentComments.torrentId, torrent.id),
    orderBy: [desc(schema.torrentComments.createdAt)],
    limit: limit + 1,
    columns: { id: true, content: true, createdAt: true },
    with: { author: { columns: { id: true, username: true } } },
  });

  return { items: rows.slice(0, limit), more: rows.length > limit };
});
