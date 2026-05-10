import pkg from './package.json';

// Set NUXT_STATIC_BUILD=true at build time to disable SSR and produce
// a fully static SPA via `pnpm exec nuxi generate`. The default build
// (Dockerfile) keeps SSR on; the alternative (Dockerfile.static)
// flips this for an nginx-served bundle. See apps/web/plugins/
// runtime-config.client.ts for how the SPA picks up tracker URLs at
// runtime so the same image can be redeployed against any domain.
const STATIC_BUILD = process.env.NUXT_STATIC_BUILD === 'true';

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  ssr: !STATIC_BUILD,

  // In the static build path Nuxt would otherwise extract a JSON payload
  // file alongside each pre-rendered route (`_payload.json`). With
  // `ssr: false` only `/` is pre-rendered; every other route falls back
  // to the SPA shell and there's no payload on disk. The client still
  // tries to fetch one on hard-reload, which then collides with nginx's
  // catch-all index.html fallback and stalls the boot. Disabling
  // extraction tells Nuxt not to bother — the SPA hydrates from the
  // bundle alone, no extra round-trip.
  experimental: STATIC_BUILD ? { payloadExtraction: false } : {},

  // Pin the prerender surface for the static build to a single
  // route (`/`). Without this Nitro's default `crawlLinks: true`
  // walks every <NuxtLink> it can find and emits a per-route HTML
  // file (e.g. `/torrents/index.html`) — those files include
  // hydration markers + asset preloads tied to the SSR pipeline,
  // which then desync against the SPA shell on hard-reload and
  // hang the boot ("loading forever" on every deep link).
  //
  // The single `/` page is enough: nginx's SPA fallback serves
  // it for any unknown URL, and vue-router routes the rest on the
  // client. Dynamic routes (`/torrents/:hash`, `/forum/topic/:id`)
  // would have failed to crawl anyway because their params aren't
  // statically known.
  nitro: {
    // esbuild target for the Nitro server bundle. Nitro defaults to
    // `es2019`, which is older than every runtime we ship and old
    // enough to refuse BigInt literal syntax (`0n` / `1024n`). Pinning
    // to `node24` matches the production runtime (distroless
    // `gcr.io/distroless/nodejs24-debian13:nonroot`) and unlocks
    // ES2025 features V8 13.6 ships — iterator helpers, Set methods,
    // `Promise.try`, `RegExp.escape`, JSON modules.
    //
    // Note: this only governs the SSR / server bundle. The client
    // bundle is emitted by Vite and is left at its default
    // (`baseline-widely-available`), which targets browsers ~1 year
    // back rather than a Node runtime.
    esbuild: {
      options: {
        target: 'node24',
      },
    },
    ...(STATIC_BUILD
      ? {
          prerender: {
            crawlLinks: false,
            routes: ['/'],
            ignore: [
              // Even if something else triggers prerender, don't
              // bother with these — they're API-side or runtime-only
              // surfaces with no static representation.
              '/api',
              '/announce',
              '/scrape',
            ],
          },
        }
      : {}),
  },

  modules: ['@pinia/nuxt', '@nuxtjs/tailwindcss', '@nuxt/icon', '@nuxtjs/i18n'],

  // i18n — see doc/guide/i18n.md for the pattern.
  //
  // strategy: 'no_prefix'
  //   URLs stay clean (`/torrents`, not `/fr/torrents`). The active locale
  //   is persisted on the user's account; the cookie below acts as a
  //   fast-path cache so SSR can render with the right locale on hard
  //   reload without paying for an /api/auth/status round-trip.
  //
  // detectBrowserLanguage:
  //   `useCookie: true` writes the active locale to `tk_locale` every
  //   time `setLocale()` is called. SSR reads it on the next hard
  //   reload and renders directly in the user's language — no flash,
  //   no hydration mismatch.
  //   `redirectOn: 'no prefix'` + `alwaysRedirect: false` defangs the
  //   redirect machinery for our `no_prefix` strategy (the previous
  //   `'root'` value triggered an SSR/CSR redirect race that crashed
  //   vue-i18n with INVALID_ARGUMENT (code 26)).
  //
  // lazy: false
  //   With only two small locale bundles (~5 KB each), shipping both
  //   in the initial JS payload is cheaper than the round-trip cost
  //   + race conditions of lazy locale loading during hydration.
  //
  // The default locale is English so any new key automatically falls
  // back to its English value when missing in another bundle, instead
  // of leaking the raw key into the UI.
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    lazy: false,
    langDir: 'locales',
    locales: [
      { code: 'en', language: 'en-US', name: 'English', file: 'en.json' },
      { code: 'fr', language: 'fr-FR', name: 'Français', file: 'fr.json' },
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'tk_locale',
      redirectOn: 'no prefix',
      alwaysRedirect: false,
      fallbackLocale: 'en',
    },
    // Explicitly disable the legacy `v-t` directive optimisation. The
    // module warns about it being on by default and slated for removal
    // in v10; we don't use the directive (we always go through `$t()`
    // / `t()`), so opting out drops the build-time AST-walk and
    // silences the deprecation notice.
    bundle: {
      optimizeTranslationDirective: false,
    },
  },

  // Icon module — see follow-up notes; the previous CSS mode rendering
  // and runtime icon fetching combined to break icons in Firefox/Safari.
  //
  // 1. mode: 'svg'
  //    Renders <Icon> as an inline `<svg>` with the path baked in, instead
  //    of `<span class="iconify i-ph:foo">` masked by a per-icon CSS rule.
  //    SVG inline is universal; CSS-mode masks were the original buggy path.
  //
  // 2. serverBundle: 'local'
  //    Bundle the icon collections we ship (Phosphor) into the server
  //    output. SSR no longer goes out to iconify.design for icon JSON
  //    on cold paths — important on networks where the API container
  //    can't reach the public internet, and faster everywhere else.
  //
  // 3. clientBundle.scan: true
  //    Pre-bundle every icon name found by static analysis of the templates
  //    into the client JS. Without this, @nuxt/icon's client-side <Icon>
  //    component falls back to an async fetch of /api/_nuxt_icon/<coll>
  //    on first render, returns an empty placeholder until the fetch
  //    resolves, and Firefox + Safari's stricter hydration replaces the
  //    SSR-rendered <svg><path/></svg> with the empty placeholder — which
  //    was the root cause of "no icons in non-Chromium browsers". The
  //    bundle keeps client-side rendering fully synchronous.
  //
  // Dynamic-name icons (e.g. `:name="mode === 'dark' ? 'ph:sun' : 'ph:moon'"`)
  // can't be discovered statically — clientBundle.icons lists them
  // explicitly so they ship in the client bundle too.
  icon: {
    mode: 'svg',
    serverBundle: 'local',
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
      icons: [
        // Theme toggle (default.vue)
        'ph:sun',
        'ph:sun-bold',
        'ph:moon',
        'ph:moon-bold',
        // Topic icons (forum/category/[id].vue)
        'ph:push-pin',
        'ph:push-pin-fill',
        'ph:push-pin-slash',
        'ph:lock',
        'ph:lock-fill',
        'ph:lock-open',
        'ph:lock-key',
        'ph:lock-key-open',
        // Category sidebar icons
        'ph:film-slate-bold',
        'ph:television-bold',
        'ph:music-notes-bold',
        'ph:game-controller-bold',
        'ph:app-window-bold',
        'ph:book-open-bold',
        'ph:shooting-star-bold',
        'ph:prohibit-bold',
        'ph:package-bold',
        'ph:folder-bold',
        // Notification toast icons
        'ph:check-circle-bold',
        'ph:x-circle-bold',
        'ph:warning-bold',
        'ph:info-bold',
      ],
    },
  },

  typescript: {
    strict: true,
    typeCheck: false,
  },

  tailwindcss: {
    cssPath: '~/assets/css/main.css',
    configPath: 'tailwind.config.ts',
  },

  runtimeConfig: {
    // Used by SSR fetches (server-side) to reach the API container directly.
    // Not exposed to the client.
    apiInternalUrl: process.env.API_INTERNAL_URL || 'http://api:4000',
    public: {
      appVersion: pkg.version,
      // Tracker URLs are read at RUNTIME from NUXT_PUBLIC_TRACKER_*_URL env vars.
      trackerHttpUrl: 'http://localhost:8080/announce',
      trackerUdpUrl: 'udp://localhost:8081/announce',
      trackerWsUrl: 'ws://localhost:8082',
    },
  },

  app: {
    head: {
      title: 'Trackarr',
      meta: [
        { name: 'description', content: 'High-performance BitTorrent tracker' },
      ],
    },
  },

  build: {
    transpile: ['chart.js', 'vue-chartjs'],
  },

  // Production sourcemaps are off across server + client. They double
  // the .output size and trigger a Nuxt internal warning from the
  // module-preload-polyfill plugin (which doesn't emit a paired map),
  // and we ship through GHCR + Caddy so there's no stack-trace UX
  // benefit at runtime. Dev mode keeps Vite's default behaviour.
  sourcemap: {
    server: false,
    client: false,
  },

  vite: {
    build: {
      // We knowingly bundle the Phosphor icon collection in full
      // (~4.5 MB of `chunks/_/icons.mjs`, ~940 kB gzip) so SSR can
      // hydrate icons without a runtime fetch — see icon.clientBundle
      // notes above. Bumping the warning ceiling to 5 MB silences
      // the rollup chunk-size advisory for that one expected chunk
      // without hiding genuinely-oversized chunks elsewhere.
      chunkSizeWarningLimit: 5000,
      // Belt-and-braces with the top-level `sourcemap.{server,client}`
      // setting above — without it, Vite's `nuxt:module-preload-polyfill`
      // plugin still injects a transform without an accompanying source
      // map and warns about the chain being incomplete. Locking it off
      // at the rollup level too keeps the build output silent.
      sourcemap: false,
      rollupOptions: {
        // Nuxt's internal `nuxt:module-preload-polyfill` plugin emits a
        // transform without a paired source map, which makes Rollup
        // warn `Sourcemap is likely to be incorrect` on every build.
        // It's a framework-level plumbing issue, not a code-quality
        // signal — silence it specifically while letting every other
        // Rollup warning surface as usual.
        onwarn(warning, defaultHandler) {
          if (
            warning.code === 'SOURCEMAP_BROKEN' ||
            (warning.plugin === 'nuxt:module-preload-polyfill' &&
              warning.message.includes('Sourcemap'))
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
  },
});
