/**
 * Pull the small set of runtime values (tracker URLs, app version) from
 * `/api/runtime-config` on app boot and patch them into the live
 * `useRuntimeConfig().public` object.
 *
 * Why client-only? With SSR the build embeds the right values from
 * env vars at server start — no fetch needed, and `useRuntimeConfig()`
 * already returns the correct object. The static build path
 * (`Dockerfile.static`) is the one that needs this: it's a fully
 * pre-rendered SPA whose chunks were minified with whatever values
 * the build environment had, so the same image can be redeployed
 * against any domain by just resetting the env on the API container.
 *
 * The patch happens before the rest of the app reads from
 * `useRuntimeConfig()` because plugins run before pages mount. A
 * fetch failure is non-fatal — the build-time fallback values stay
 * in place, which matches what would happen if the API were briefly
 * unreachable on load.
 */
export default defineNuxtPlugin({
  name: 'runtime-config',
  enforce: 'pre',
  // Run in parallel with the rest of the boot so the app can mount
  // even if /api/runtime-config is slow or unreachable. The previous
  // `parallel: false` chained the boot behind this single fetch — a
  // hung connection meant the SPA never got past the splash on every
  // route except `/` (which has its own pre-rendered HTML).
  parallel: true,
  async setup() {
    const cfg = useRuntimeConfig();
    try {
      // Hard ceiling: 4 s is plenty for a same-origin fetch over
      // Caddy. Anything longer means something's broken — fall back
      // to the build-time values rather than blocking forever.
      const remote = await $fetch<{
        trackerHttpUrl: string;
        trackerUdpUrl: string;
        trackerWsUrl: string;
        appVersion: string;
      }>('/api/runtime-config', { timeout: 4000 });

      // Mutate in place — `cfg.public` is the same reactive-ish object
      // that any later `useRuntimeConfig()` call returns.
      if (remote.trackerHttpUrl)
        cfg.public.trackerHttpUrl = remote.trackerHttpUrl;
      if (remote.trackerUdpUrl)
        cfg.public.trackerUdpUrl = remote.trackerUdpUrl;
      if (remote.trackerWsUrl)
        cfg.public.trackerWsUrl = remote.trackerWsUrl;
      if (remote.appVersion) cfg.public.appVersion = remote.appVersion;
    } catch {
      // Fail-soft: keep the build-time values. The /me announce URL
      // and similar surfaces still render — they may just point to a
      // stale host until the user reloads.
    }
  },
});
