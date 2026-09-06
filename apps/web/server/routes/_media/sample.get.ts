import { createError, defineEventHandler, getHeader, getQuery, setHeader } from 'h3';

/**
 * Un pixel d'affiche, pour la couleur de l'œuvre.
 *
 * Le héros de la fiche échantillonne l'affiche sur une toile pour teinter son
 * décor. Les CDN d'affiches n'envoient pas d'en-tête CORS (mesuré sur TMDB :
 * en mode `anonymous` l'image ne charge pas, et sans lui la toile est
 * souillée) ; l'image passe donc par ici, même origine, et la toile reste
 * lisible.
 *
 * Ce n'est PAS un relais d'images : trois hôtes connus, HTTPS seulement,
 * aucune redirection suivie, un type `image/*` exigé, 400 Ko au plus, quatre
 * secondes au plus, et seulement depuis nos propres pages (`Sec-Fetch-Site`).
 * Mis en cache un jour : une affiche ne change pas.
 */
const HOSTS = new Set(['image.tmdb.org', 'images.igdb.com', 'covers.openlibrary.org']);
const MAX_BYTES = 400 * 1024;
const TIMEOUT_MS = 4000;

export default defineEventHandler(async (event) => {
  const site = getHeader(event, 'sec-fetch-site');
  if (site && site !== 'same-origin') throw createError({ statusCode: 403, statusMessage: 'Forbidden' });

  const raw = String(getQuery(event).src ?? '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad source' });
  }
  if (url.protocol !== 'https:' || !HOSTS.has(url.hostname)) {
    throw createError({ statusCode: 400, statusMessage: 'Bad source' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { signal: ctrl.signal, redirect: 'error', headers: { accept: 'image/*' } });
  } catch {
    throw createError({ statusCode: 502, statusMessage: 'Upstream unavailable' });
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get('content-type') ?? '';
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (!res.ok || !type.startsWith('image/') || declared > MAX_BYTES) {
    throw createError({ statusCode: 502, statusMessage: 'Not an image' });
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) throw createError({ statusCode: 502, statusMessage: 'Too large' });

  setHeader(event, 'content-type', type);
  setHeader(event, 'cache-control', 'public, max-age=86400, immutable');
  setHeader(event, 'x-content-type-options', 'nosniff');
  return bytes;
});
