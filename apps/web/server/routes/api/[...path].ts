import { proxyRequest } from 'h3';

/**
 * Catch-all proxy: every /api/** request hitting the web container is
 * forwarded to the API service. Used in two cases:
 *
 *   1. SSR `useFetch('/api/...')` / `$fetch('/api/...')` from inside Nuxt:
 *      without this handler the path falls through to the Nuxt router,
 *      where the global auth middleware redirects 302 → /auth/register
 *      (since the web container has no real /api/* routes), so pages
 *      like register.vue and login.vue receive HTML instead of JSON and
 *      `status` ends up undefined — which triggers the worst-case
 *      "Registration Closed" branch in the v-if even on a fresh DB.
 *
 *   2. Local docker-compose setups without Caddy where the browser
 *      hits localhost:3000/api/* directly. In production Caddy routes
 *      /api/* straight to the API container, so this proxy handler
 *      never gets invoked from the client.
 *
 * h3's `proxyRequest` forwards method, headers (including Cookie), body,
 * and query string verbatim, so sessions remain authenticated end-to-end.
 */
export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig();
  const apiBase = (config.apiInternalUrl as string).replace(/\/+$/, '');
  const target = apiBase + event.path;
  return await proxyRequest(event, target, {
    // Strip headers a real reverse proxy would not blindly forward.
    headers: { host: undefined as any },
  });
});
