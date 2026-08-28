/**
 * GET /api/theme.css — every enabled theme, as one stylesheet.
 *
 * Public and unauthenticated, like `/api/branding`, because the login page needs
 * a theme too and an anonymous visitor has no `users.theme` to read.
 *
 * ## Why a route and not an inlined `<style>`
 *
 * `apps/web` ships in two shapes: SSR, and a static SPA served by nginx with no
 * server at all (`ssr: !STATIC_BUILD`). The SPA has nothing that can inline a
 * style block at render time, so a `<link>` is the only mechanism that works in
 * both — and a stylesheet in `<head>` is render-blocking, which means the first
 * paint waits for it rather than flashing the wrong appearance.
 *
 * It also needs nothing from the CSP: same-origin through Caddy, so
 * `style-src 'self'` covers it. No nonce, no `'unsafe-inline'`.
 *
 * ## Caching
 *
 * `ETag` is the theme version counter, bumped by every write and propagated
 * across replicas by the settings cache's Redis channel. `max-age=60` matches
 * that cache's TTL, so the worst case for an admin who just saved is one minute
 * of stale CSS on an already-loaded page — and a reload revalidates.
 *
 * Deliberately NOT `immutable` with a hashed URL: the static build has to name
 * this URL at build time, before any theme exists.
 */
import { themeStylesheet } from '~~/utils/themes';

export default defineEventHandler(async (event) => {
  const { css, version } = await themeStylesheet();
  const etag = `W/"themes-${version}"`;

  setHeader(event, 'Content-Type', 'text/css; charset=utf-8');
  setHeader(event, 'Cache-Control', 'public, max-age=60, must-revalidate');
  setHeader(event, 'ETag', etag);
  // The stylesheet is identical for every viewer — see the note on
  // `themes.visibility` for why role-gated themes are served to everyone and
  // enforced at the write path instead. Saying so in a header keeps a future
  // reader from adding `Vary: Cookie` and quietly destroying the cache.
  setHeader(event, 'Vary', 'Accept-Encoding');

  if (getHeader(event, 'if-none-match') === etag) {
    setResponseStatus(event, 304);
    return null;
  }

  return css;
});
