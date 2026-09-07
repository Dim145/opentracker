import { and, desc, eq, lt, sql } from 'drizzle-orm';
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
  /** L'identifiant de la ligne du curseur : deux commentaires peuvent partager une date. */
  beforeId: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(COMMENTS_PAGE_SIZE),
});

export default defineEventHandler(async (event) => {
  const session = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const hash = validateParam(event, 'hash', infoHashSchema).toLowerCase();
  const { before, beforeId, limit } = validateQuery(event, querySchema);
  const torrent = await assertVisibleTorrent(hash, session.user);

  /*
   * Le curseur porte la date ET l'identifiant, comparés en couple.
   *
   * Sur la seule date, deux commentaires écrits dans la même transaction (un
   * import partage un `now()`) rendaient la page suivante vide pour toujours,
   * ou faisaient sauter la ligne frontière. `::timestamp` plutôt qu'un `Date` :
   * la colonne est sans fuseau, et le texte revient tel que l'API l'a émis.
   */
  const cursor =
    before && beforeId
      ? sql`(${schema.torrentComments.createdAt}, ${schema.torrentComments.id}) < (${before}::timestamp, ${beforeId})`
      : before
        ? lt(schema.torrentComments.createdAt, sql`${before}::timestamp`)
        : undefined;

  // Une ligne de plus que demandé : sa présence dit qu'il en reste, sans un
  // `count(*)` sur tout le fil à chaque page.
  const rows = await db.query.torrentComments.findMany({
    where: cursor
      ? and(eq(schema.torrentComments.torrentId, torrent.id), cursor)
      : eq(schema.torrentComments.torrentId, torrent.id),
    orderBy: [desc(schema.torrentComments.createdAt), desc(schema.torrentComments.id)],
    limit: limit + 1,
    columns: { id: true, content: true, createdAt: true },
    with: { author: { columns: { id: true, username: true } } },
  });

  return { items: rows.slice(0, limit), more: rows.length > limit };
});
