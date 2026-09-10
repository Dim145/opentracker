import { z } from 'zod';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { db, schema } from '@trackarr/db';
import { eq } from 'drizzle-orm';
import { candidateKeys } from '~~/utils/metadata/cached';

/**
 * POST /api/metadata/tint — la teinte de l'affiche, mise en cache avec la fiche.
 *
 * La fiche d'un torrent calcule déjà la couleur dominante de son affiche (un
 * canevas de 12×18 côté navigateur) et la pose sur son bandeau. Le catalogue
 * veut la même couleur sur le filet des cartes d'œuvres, sans refaire vingt
 * fois ce calcul ni vingt fois l'image : la fiche la dépose ici, le cache la
 * garde trente jours, `worksFromCache` la lit avec le titre et l'affiche.
 *
 * Trois entiers 0-255, rien d'autre : ce que le navigateur envoie n'est pas
 * une couleur qu'on injecte, c'est trois nombres qu'on revalide.
 */
const bodySchema = z.object({
  // Les trois sources qui ont une fiche en cache ; IMDb et TVDB se résolvent en TMDb avant.
  source: z.enum(['tmdb', 'igdb', 'openlibrary']),
  id: z.string().trim().min(1).max(128),
  tint: z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}$/),
});
const TINT_TTL_S = 30 * 86400;
/** La forme d'un identifiant par source : rien d'autre ne devient une clé Redis. */
const ID_SHAPE: Record<string, RegExp> = {
  // Nu ou préfixé : les releases portent l'un ou l'autre, `candidateKeys` sait les deux.
  tmdb: /^((movie|tv)\/)?\d{1,10}$/,
  igdb: /^\d{1,10}$/,
  openlibrary: /^OL\d{1,10}[WM]$/,
};

export const tintCacheKey = (source: string, id: string) => `meta:v1:tint:${source}:${id}`;

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const body = await validateBody(event, bodySchema);
  const channels = body.tint.split(' ').map(Number);
  if (channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw createError({ statusCode: 400, message: 'tint: each channel must be 0-255' });
  }
  if (!ID_SHAPE[body.source]?.test(body.id)) {
    throw createError({ statusCode: 400, message: 'id: not an identifier of this source' });
  }
  // Seulement une œuvre que le cache connaît déjà : la fiche l'a cherchée avant
  // d'en calculer la couleur. Sans cela, chaque membre pouvait semer des clés à
  // volonté. La réponse ne dit PAS si l'œuvre était connue : un 404 ici
  // répondait « cette instance a-t-elle cette œuvre ? » à qui la demandait.
  const me = await db.query.users.findFirst({ where: eq(schema.users.id, user.id), columns: { language: true } });
  const known = await redis.exists(...candidateKeys({ source: body.source, id: body.id }, me?.language ?? undefined));
  if (known) await redis.set(tintCacheKey(body.source, body.id), channels.join(' '), 'EX', TINT_TTL_S);
  return { ok: true };
});
