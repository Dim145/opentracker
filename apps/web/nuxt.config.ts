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

  modules: ['@pinia/nuxt', '@nuxtjs/tailwindcss', '@nuxt/icon'],

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
});
