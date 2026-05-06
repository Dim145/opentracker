/**
 * SSR-side fetch routing.
 *
 * - In the browser, `$fetch('/api/...')` is a relative call that goes through
 *   Caddy (same-origin), so we don't touch it.
 * - During SSR, `$fetch('/api/...')` would target the Nuxt server itself
 *   (which no longer hosts /api/* — it's all in the api container). We
 *   override $fetch on the server to point at the internal API URL and forward
 *   the incoming request's cookies so sessions still work.
 */
export default defineNuxtPlugin(() => {
  if (!import.meta.server) return;

  const config = useRuntimeConfig();
  const event = useRequestEvent();
  const cookieHeader = event?.node?.req?.headers?.cookie;

  // Replace the global $fetch on the server with a configured instance.
  // Client-side calls keep the default (same-origin, browser cookies).
  globalThis.$fetch = $fetch.create({
    baseURL: config.apiInternalUrl as string,
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
});
