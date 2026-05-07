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

  const config = useRuntimeConfig();
  const apiBase = (config.apiInternalUrl as string).replace(/\/+$/, '');
  const target = apiBase + event.path;
  return await proxyRequest(event, target, {
    // Strip headers a real reverse proxy would not blindly forward.
    headers: { host: undefined as any },
  });
});
