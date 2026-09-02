import { proxyRequest } from 'h3';

/**
 * Catch-all proxy: forwards /api/** requests hitting the web container to
 * the API service. Used in two cases:
 *
 *   1. SSR `useFetch('/api/...')` / `$fetch('/api/...')` from inside Nuxt.
 *      Without this handler the path falls through to the Nuxt router,
 *      where the global auth middleware redirects 302 → /auth/register
 *      (since the web container has no real /api/* routes), so pages
 *      like register.vue and login.vue receive HTML instead of JSON and
 *      `status` ends up undefined.
 *
 *   2. Local docker-compose setups without Caddy where the browser hits
 *      localhost:3000/api/* directly. In production Caddy routes /api/*
 *      straight to the API container, so this proxy handler never gets
 *      invoked from the client.
 *
 * IMPORTANT — Nuxt-internal /api/* paths are excluded:
 *
 *   - /api/_nuxt_icon/*  — @nuxt/icon's runtime endpoint that serves icon
 *     SVG payloads. Forwarding it to the upstream API gave 404s, the
 *     client-side icon resolver fell back to an empty placeholder, and
 *     during hydration Firefox + Safari's stricter mismatch handling
 *     replaced the SSR-rendered SVG with the empty placeholder — which
 *     is why icons "disappeared" outside Chromium. Chromium silently
 *     kept the SSR'd SVG.
 *
 * Returning a 404 ourselves rather than proxying ensures the upstream API
 * never sees these requests. The actual fix for icons is paired with this
 * one: nuxt.config.ts now enables `icon.clientBundle.scan` so every icon
 * found in templates is shipped in the client JS — the runtime endpoint
 * is no longer hit for any of them, and dynamic icon names that AREN'T in
 * the scan would now 404 here cleanly instead of silently round-tripping
 * to the API.
 */
const NUXT_INTERNAL_PATHS = ['/api/_nuxt_icon/', '/api/__nuxt'];

export default defineEventHandler(async (event) => {
  if (NUXT_INTERNAL_PATHS.some((p) => event.path.startsWith(p))) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
    });
  }

  // Le chemin, avant de bâtir la cible.
  //
  // `event.path` est brut : `GET /api/../uploads/x` (avec un client qui ne
  // normalise pas — `curl --path-as-is`) correspond quand même à ce
  // catch-all, puis l'analyse d'URL d'undici replie le `..` et produit
  // `http://api:4000/uploads/x`. La portée est bornée — l'API ne monte que
  // `/api` et `/uploads`, et `/uploads` est joignable directement — mais cela
  // permettait d'atteindre `/uploads` par l'origine web, et c'est une ligne.
  //
  // Sur le chemin DÉCODÉ, pas sur la chaîne brute. `includes('..')` ne voyait
  // pas `%2e%2e` — mesuré : `/api/%2e%2e/uploads/x` passait la garde, et le
  // parseur d'URL WHATWG repliait ensuite l'encodage en un vrai segment
  // double-point, donnant `http://api:4000/uploads/x`. Une garde écrite exprès
  // qui ne fait pas ce qu'elle annonce est pire qu'aucune garde : elle donne
  // la certitude d'être couvert.
  //
  // On normalise avec le même analyseur que celui qui fera le repli plus bas,
  // puis on exige que ce qui en sort reste dans `/api/`. Un chemin qui remonte
  // ailleurs — quelle que soit la façon dont il l'écrit — n'est plus un chemin
  // que ce catch-all a le droit de relayer.
  let normalised: string;
  try {
    normalised = new URL(event.path, 'http://internal').pathname;
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }
  if (normalised !== event.path.split('?')[0] || !normalised.startsWith('/api/')) {
    throw createError({ statusCode: 400, statusMessage: 'Bad Request' });
  }

  const config = useRuntimeConfig();
  const apiBase = (config.apiInternalUrl as string).replace(/\/+$/, '');
  const target = apiBase + event.path;

  /*
   * Les en-têtes, construits ici plutôt que relayés tels quels.
   *
   * `headers: { host: undefined }` était un no-op : `mergeHeaders` de h3 fait
   * `if (value !== undefined) merged.set(...)`, donc une valeur `undefined` ne
   * SUPPRIME rien — `host` ne disparaissait que parce qu'il figure déjà dans la
   * liste ignorée de h3. Le commentaire « strip headers a real reverse proxy
   * would not blindly forward » décrivait donc une intention que le code
   * n'implémentait pas : `X-Forwarded-For`, `X-Real-IP`, `X-Forwarded-Proto` et
   * `CF-Connecting-IP` fournis par le NAVIGATEUR arrivaient verbatim à l'API,
   * qui s'en sert pour la limitation de débit et le journal de connexions.
   *
   * Le déploiement livré reste sûr — Caddy écrase les deux en-têtes avec
   * `{remote_host}` et `getClientIP` parcourt de droite à gauche — mais cette
   * couche est un proxy qui ne se comportait pas comme tel : elle ne retirait
   * pas ce dont elle ne peut répondre, et n'ajoutait pas le pair qu'elle
   * observe.
   */
  const SPOOFABLE = [
    'x-forwarded-for',
    'x-forwarded-host',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-real-ip',
    'forwarded',
    'cf-connecting-ip',
    'true-client-ip',
  ];
  const headers = getProxyRequestHeaders(event);
  for (const name of SPOOFABLE) delete (headers as Record<string, unknown>)[name];
  const observed = getRequestIP(event, { xForwardedFor: false });
  if (observed) (headers as Record<string, string>)['x-forwarded-for'] = observed;

  return await proxyRequest(event, target, { headers: headers as HeadersInit });
});
