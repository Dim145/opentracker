import { z } from 'zod';
import { redis } from '~~/utils/server';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { ALL_SOURCE_IDS, type LookupSource } from '~~/utils/metadata';
import { validateBody } from '~~/utils/schemas';

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
  source: z.enum(ALL_SOURCE_IDS as [LookupSource, ...LookupSource[]]),
  id: z.string().trim().min(1).max(128),
  tint: z.string().regex(/^\d{1,3} \d{1,3} \d{1,3}$/),
});
const TINT_TTL_S = 30 * 86400;

export const tintCacheKey = (source: string, id: string) => `meta:v1:tint:${source}:${id}`;

export default defineEventHandler(async (event) => {
  await requireUserSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const body = await validateBody(event, bodySchema);
  const channels = body.tint.split(' ').map(Number);
  if (channels.some((c) => !Number.isInteger(c) || c < 0 || c > 255)) {
    throw createError({ statusCode: 400, message: 'tint: each channel must be 0-255' });
  }
  await redis.set(tintCacheKey(body.source, body.id), channels.join(' '), 'EX', TINT_TTL_S);
  return { ok: true };
});
