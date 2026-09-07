import { createError, defineEventHandler, getHeader, getQuery, getRequestIP, setHeader } from 'h3';

/**
 * Un pixel d'affiche, pour la couleur de l'œuvre.
 *
 * Le héros de la fiche échantillonne l'affiche sur une toile pour teinter son
 * décor. Les CDN d'affiches n'envoient pas d'en-tête CORS (mesuré sur TMDB :
 * en mode `anonymous` l'image ne charge pas, et sans lui la toile est
 * souillée) ; l'image passe donc par ici, même origine, et la toile reste
 * lisible.
 *
 * Ce n'est PAS un relais d'images, et la revue a resserré chaque maille :
 *
 *   - trois hôtes connus, HTTPS, port par défaut, sans identifiants dans l'URL,
 *     aucune redirection suivie ;
 *   - seulement depuis nos pages : `Sec-Fetch-Site: same-origin` ET
 *     `Sec-Fetch-Dest: image` sont EXIGÉS — un client sans ces en-têtes (curl,
 *     une navigation directe, un vieux Safari) reçoit 403 et la fiche reste
 *     simplement sans teinte ;
 *   - des formats matriciels uniquement : un SVG servi depuis notre origine et
 *     ouvert comme document exécuterait ses scripts chez nous ;
 *   - 400 Ko au plus, comptés PENDANT la lecture — un flux sans
 *     `content-length` ne peut pas remplir la mémoire avant la vérification ;
 *   - quatre secondes, une CSP qui interdit tout au document servi, et une
 *     limite par adresse pour que personne ne fasse marteler les CDN par ce
 *     serveur.
 *
 * Mis en cache un jour : une affiche ne change pas.
 */
const HOSTS = new Set(['image.tmdb.org', 'images.igdb.com', 'covers.openlibrary.org']);
const RASTER = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_BYTES = 400 * 1024;
const TIMEOUT_MS = 4000;

/** 60 échantillons par minute et par adresse : une fiche en demande un. */
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 60;
const hits = new Map<string, number[]>();
function overQuota(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  // La table ne garde que les adresses actives : au-delà de mille, on élague.
  if (hits.size > 1000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= RATE_WINDOW_MS)) hits.delete(k);
  }
  return recent.length > RATE_MAX;
}

export default defineEventHandler(async (event) => {
  if (getHeader(event, 'sec-fetch-site') !== 'same-origin' || getHeader(event, 'sec-fetch-dest') !== 'image') {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' });
  }
  const ip = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown';
  if (overQuota(ip)) throw createError({ statusCode: 429, statusMessage: 'Too many requests' });

  const raw = String(getQuery(event).src ?? '');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad source' });
  }
  if (
    url.protocol !== 'https:' ||
    !HOSTS.has(url.hostname) ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    throw createError({ statusCode: 400, statusMessage: 'Bad source' });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(url, { signal: ctrl.signal, redirect: 'error', headers: { accept: 'image/*' } });
    } catch {
      throw createError({ statusCode: 502, statusMessage: 'Upstream unavailable' });
    }
    const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (!res.ok || !RASTER.has(type) || declared > MAX_BYTES || !res.body) {
      throw createError({ statusCode: 502, statusMessage: 'Not an image' });
    }

    // Lecture bornée : on s'arrête au premier octet de trop, sans attendre la
    // fin du flux.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) {
          await reader.cancel();
          throw createError({ statusCode: 502, statusMessage: 'Too large' });
        }
        chunks.push(value);
      }
    } catch (err) {
      // Le délai tombé pendant la lecture arrive ici en AbortError : un 504, pas un 500 avec sa pile.
      if ((err as { statusCode?: number }).statusCode) throw err;
      throw createError({ statusCode: 504, statusMessage: 'Upstream timeout' });
    }

    setHeader(event, 'content-type', type);
    setHeader(event, 'cache-control', 'public, max-age=86400, immutable');
    setHeader(event, 'x-content-type-options', 'nosniff');
    setHeader(event, 'content-security-policy', "default-src 'none'; sandbox");
    return Buffer.concat(chunks);
  } finally {
    clearTimeout(timer);
  }
});
