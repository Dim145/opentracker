/**
 * GET /api/runtime-config
 *
 * Public endpoint that surfaces the small set of *runtime* config values
 * the browser bundle needs to know — primarily the public tracker URLs
 * (HTTP / UDP / WebSocket).
 *
 * Why an endpoint instead of build-time substitution? When the web app
 * is served as a fully static bundle (the new Dockerfile.static path,
 * built with `pnpm nuxi generate`), the values inside
 * `useRuntimeConfig().public` are baked into the JS chunks at build
 * time. The same image then can't be re-deployed against a different
 * domain without rebuilding. Exposing the values via an API call lets
 * a single image work in dev, staging and prod — the operator just
 * sets the relevant `NUXT_PUBLIC_TRACKER_*_URL` env vars on the API
 * container, and the SPA fetches them on boot.
 *
 * No authentication: these URLs are needed before any user has a
 * session (the magnet-link scheme on the torrent detail page works
 * for logged-out clients via the standard Caddy proxy), and they're
 * already public information — anyone can announce against them with
 * a valid passkey. Cached for 5 minutes by the CDN/edge to amortise
 * the round-trip across page loads.
 */
export default defineEventHandler((event) => {
  const cfg = useRuntimeConfig();
  setHeader(event, 'cache-control', 'public, max-age=300');
  return {
    trackerHttpUrl: (cfg.public.trackerHttpUrl as string) ?? '',
    trackerUdpUrl: (cfg.public.trackerUdpUrl as string) ?? '',
    trackerWsUrl: (cfg.public.trackerWsUrl as string) ?? '',
    appVersion: (cfg.public.appVersion as string) ?? '',
  };
});
