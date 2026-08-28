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

  modules: [
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@nuxt/icon',
    '@nuxtjs/i18n',
    '@nuxt/fonts',
  ],

  // Fonts — self-hosted, and deliberately NOT plug-and-play.
  //
  // ## Why self-host at all
  //
  // `main.css` used to open with an `@import` to `fonts.googleapis.com`, which
  // meant the IP of every visitor reached Google on every page load. On a
  // private tracker that is a privacy leak rather than a performance question,
  // and it is what forced two third-party origins into the CSP
  // (`fonts.googleapis.com` in `style-src`, `fonts.gstatic.com` in `font-src`).
  // Both are gone now — see `server/plugins/csp.ts` and
  // `docker/static/nginx.conf`. The module downloads the faces at build time
  // and serves them from `/_fonts/`, so the running site talks to nobody.
  //
  // ## Why every family is listed by hand
  //
  // The module detects `font-family` in CSS — including inside `--font-*`
  // custom properties, which is where this codebase's three stacks now live —
  // and resolves what it finds against its providers. Left to itself that is
  // wrong here in both directions:
  //
  //   - This codebase NAMES four families it has never loaded, and Google
  //     serves all four: `Source Serif 4`, `IBM Plex Mono`, `Fira Code` and
  //     `Cascadia Code`. Auto-detection would have started downloading them as a
  //     side effect of a hosting change, which is the wrong reason. Three of
  //     them are now loaded deliberately, as entries on the curated list a theme
  //     can choose from; `Cascadia Code` stays pinned to `provider: 'none'`,
  //     since nothing offers it and the fallback behind it is what renders.
  //   - The system faces further down those chains (`Charter`, `Iowan Old
  //     Style`, `Palatino`…) resolve to nothing anywhere, and `throwOnError`
  //     is true at build time. Naming them costs one line each and removes the
  //     question.
  //
  // ## Weights and subsets
  //
  // Both are what the `@import` actually asked for, not the module's defaults.
  // The defaults would have pulled seven subsets — Cyrillic, Greek, Vietnamese
  // — for a site with two locales, and a `400 700` variable range for faces
  // this site uses at fixed weights.
  //
  //
  // ## The cost, stated plainly
  //
  // The privacy win moves the Google dependency from every page view to every
  // BUILD. `throwOnError` defaults to true when building, so a Google outage,
  // a rate-limit or an offline machine FAILS the build rather than quietly
  // shipping an image with no faces — which is the right way round, but it does
  // mean a release now needs network. 336 kB across eight `.woff2`, cached in
  // `node_modules/.cache/nuxt/fonts` between builds on the same machine and
  // therefore cold on a CI runner. The alternative was committing the files, and
  // it is still the escape hatch if that ever bites: `provider: 'local'` with
  // the faces under `public/fonts/`.
  //
  // It also means the faces are not pinned. Google can reship a family and two
  // builds of the same tag will not be byte-identical — out of character for a
  // repository that pins `postgres:18.6-alpine` and hand-edits migration SQL for
  // determinism. Accepted for the privacy win and because the curated font list
  // needs a provider that can resolve families this repository has never seen.
  //
  // MEASURED, not hypothetical: one build in about ten failed with `ETIMEDOUT`
  // reaching `fonts.googleapis.com` from inside the BuildKit container, while
  // the same request succeeded from the host and from an ordinary container at
  // the same moment. An immediate retry then worked. So the practical failure
  // mode is a flaky release rather than a broken one, and the practical
  // mitigation is to retry the build — but a release job that cannot tolerate a
  // retry should switch these entries to `provider: 'local'` with the woff2
  // files committed under `public/fonts/`, which removes the network from the
  // build entirely at the cost of about 1.4 MB in git.
  fonts: {
    defaults: {
      subsets: ['latin', 'latin-ext'],
      styles: ['normal', 'italic'],
    },
    families: [
      // 800 and 900 are real now. The site writes `font-weight: 800` 191 times
      // and `900` 22 times against a face loaded at 400-700, so the browser has
      // been synthesising both — smearing the glyphs wider than the design.
      //
      // It costs nothing: Inter is a variable font, so one file per subset
      // already carried the whole 100-900 axis and the request only widened
      // which part of it the `@font-face` claims. Same eight files, same 336 kB.
      // The real weights are NARROWER than the synthetic ones, so lines get
      // slightly shorter — the safe direction, since nothing that fitted before
      // stops fitting.
      {
        name: 'Inter',
        provider: 'google',
        weights: [400, 500, 600, 700, 800, 900],
        styles: ['normal'],
      },
      { name: 'JetBrains Mono', provider: 'google', weights: [400, 500], styles: ['normal'] },
      // Variable, and used italic at every size from a 14px byline to a 60px
      // masthead — hence the full axis rather than a weight list.
      { name: 'Fraunces', provider: 'google', weights: ['400 900'] },
      // The curated list a theme can choose from (`FONT_STACKS` in
      // packages/shared/src/theme.ts). Every one carries `global: true`, and
      // that is load-bearing rather than tidy: these names appear in no
      // `font-family` declaration anywhere in the source — they only ever reach
      // CSS through a theme's block, generated at runtime — so the module's
      // usage scan cannot see them and would emit no `@font-face` at all. A
      // theme would then select a font the browser has never heard of.
      //
      // The image grows; the page does not. `@font-face` is a declaration, and
      // a browser fetches a face only when something actually uses it, so a
      // visitor downloads the active theme's faces and nothing else.
      { name: 'Manrope', provider: 'google', global: true, weights: ['400 700'] },
      { name: 'Figtree', provider: 'google', global: true, weights: ['400 700'] },
      { name: 'IBM Plex Sans', provider: 'google', global: true, weights: [400, 500, 600, 700] },
      { name: 'Atkinson Hyperlegible', provider: 'google', global: true, weights: [400, 700] },
      { name: 'IBM Plex Mono', provider: 'google', global: true, weights: [400, 500] },
      { name: 'Fira Code', provider: 'google', global: true, weights: ['400 500'] },
      { name: 'Space Mono', provider: 'google', global: true, weights: [400, 700] },
      { name: 'Playfair Display', provider: 'google', global: true, weights: ['400 900'] },
      { name: 'Bitter', provider: 'google', global: true, weights: ['400 700'] },
      { name: 'Instrument Serif', provider: 'google', global: true, weights: [400] },
      { name: 'Source Serif 4', provider: 'google', global: true, weights: ['400 700'] },

      // Named in a fallback chain, never loaded. Keep it that way.
      { name: 'Cascadia Code', provider: 'none' },
      { name: 'Charter', provider: 'none' },
      { name: 'Iowan Old Style', provider: 'none' },
      { name: 'Palatino Linotype', provider: 'none' },
      { name: 'Palatino', provider: 'none' },
    ],
  },

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
  // Locale loading is always lazy since module v10 (the `lazy` flag was
  // removed): each bundle is fetched on demand. Our `setLocale()` calls
  // are awaited (see plugins/i18n-user.client.ts), so a switch never
  // renders against a half-loaded message set.
  //
  // The default locale is English so any new key automatically falls
  // back to its English value when missing in another bundle, instead
  // of leaking the raw key into the UI.
  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
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
    // Server bundles Phosphor in full (~4.5 MB) for SSR hydration.
    // simple-icons isn't included here on purpose — pulling the
    // whole 5 MB collection just to render 2 brand logos (ntfy,
    // mattermost) inflates the server bundle without buying useful
    // SSR. Those two icons live in `clientBundle.icons` below
    // instead: the client fetches them at hydration, the only
    // visible effect is a sub-100ms placeholder on first paint of
    // the settings page.
    serverBundle: { collections: ['ph'] },
    clientBundle: {
      scan: true,
      includeCustomCollections: true,
      // Lifted from the default 256 KB. @nuxt/icon warns when the
      // bundle crosses 75 % of this ceiling; the current set (425
      // icons, ~194 KB) sat right at the edge and noised up every
      // docker build with "close to the limit". 320 KB leaves the
      // headroom for the next half-dozen new icons before we have
      // to revisit whether they really need to be client-bundled.
      sizeLimitKb: 320,
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
        // Notification-channel logos. Passed via the channel
        // registry's `icon` field, so the static scanner can't find
        // them in templates — we enumerate them here to keep the
        // SSR + client bundles self-sufficient (no /api/_nuxt_icon
        // round-trip at first paint). Brand logos that exist in
        // simple-icons (ntfy, Mattermost) use that collection;
        // Gotify / Pushover / Apprise have no simple-icons entry
        // so we fall back to semantically-close Phosphor glyphs.
        'ph:envelope-simple-bold',
        'ph:telegram-logo-bold',
        'ph:discord-logo-bold',
        'ph:slack-logo-bold',
        'ph:webhooks-logo-bold',
        'ph:broadcast-bold',
        'ph:bell-simple-bold',
        'ph:tree-structure-bold',
        'simple-icons:ntfy',
        'simple-icons:mattermost',
        // Section / state glyphs used dynamically in the
        // NotificationsSection redesign.
        'ph:plug-charging-bold',
        'ph:cloud-arrow-up-bold',
        'ph:siren-bold',
        'ph:user-circle-bold',
        'ph:coin-bold',
        'ph:shield-check-bold',
        'ph:chats-circle-bold',
        'ph:envelope-open-bold',
        'ph:gavel-bold',
        'ph:bell-slash-bold',
        'ph:bell-ringing-bold',
        'ph:sliders-bold',
        'ph:paper-plane-tilt-bold',
        'ph:trash-bold',
        'ph:floppy-disk-bold',
        'ph:check-bold',
        'ph:plus-bold',
        'ph:caret-down-bold',
        'ph:circle-notch',
        // Variable-group icons in template/TemplateEditorModal.vue. They come
        // from a GROUP_ICONS record rather than a literal `name=`, so the
        // scanner cannot see them.
        'ph:text-aa',
        'ph:list-dashes',
        'ph:star',
        'ph:article',
        'ph:sliders-horizontal',
        'ph:package',
        'ph:toggle-left',
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

  // Emit security headers from the SSR layer itself so the web container is
  // self-protecting even if it's ever exposed without Caddy in front (direct
  // port publish, alternate ingress, a proxy that doesn't replicate the
  // header block) — finding L11. Mirrors docker/caddy/Caddyfile; HSTS is
  // intentionally left to the TLS edge (Caddy), since the SSR container
  // serves plain HTTP internally.
  routeRules: {
    '/**': {
      headers: {
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy':
          'geolocation=(), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
        // Content-Security-Policy is NOT set here. It carries a per-response
        // nonce so `script-src` can drop `'unsafe-inline'`, which a static
        // header cannot express — see server/plugins/csp.ts.
      },
    },
  },

  app: {
    head: {
      title: 'Trackarr',
      meta: [
        { name: 'description', content: 'High-performance BitTorrent tracker' },
      ],
      script: [
        {
          /**
           * The cookie, applied before the first paint.
           *
           * Here for the same reason the stylesheet link is, and it is the same
           * bug found twice: `useHead` in `app.vue` does not run in the static
           * build, so this script reached the SSR markup and nowhere else. A
           * member whose theme is NOT the site default therefore saw the default
           * painted first and their own theme only once the bundle had booted —
           * the exact case an operator running the `front` image would notice.
           *
           * `app.head` puts it in the HTML both shapes generate, where it is a
           * blocking inline script in `<head>` and runs before anything paints.
           *
           * Under SSR the server has already written the attribute from the same
           * cookie, so this agrees with it rather than fighting it.
           *
           * What it does, and what it deliberately does not:
           *
           * It checks the SHAPE of the cookie and nothing else. Which themes
           * exist is the server's business, and a slug that no longer does
           * resolves to the site default on the next `/api/auth/status` — a
           * wrong theme for one paint beats an unthemed one, and beats a script
           * that has to know the list.
           *
           * No cookie means "follows the site default", and it writes NOTHING
           * for that case: `/api/theme.css` emits the default under a bare
           * `:root`, so a document with no attribute is already painted right.
           * Guessing `dark` here is what made the static build flash before.
           */
          // The shipped script carries no comments: it is inline in every
          // document this application serves, so its prose is bytes on every
          // page load. The reasoning lives above, in source, where it costs
          // nobody anything.
          //
          // No backticks inside the literal — one in a comment closed it once
          // already, which is how that rule got written down.
          innerHTML: `
            (function () {
              try {
                var m = document.cookie.match(/(?:^|;\\s*)trackarr-theme=([^;]*)/);
                var v = m ? decodeURIComponent(m[1]) : '';
                if (/^[a-z0-9-]{1,64}$/.test(v)) {
                  document.documentElement.setAttribute('data-theme', v);
                }
              } catch (e) {}
            })();
          `,
          tagPosition: 'head',
        },
      ],
      link: [
        {
          /**
           * The theme stylesheet, in the document from the start.
           *
           * Here rather than in `app.vue`'s `useHead` for one reason, and it is
           * the whole reason the static build could not theme its first paint:
           * with `ssr: false` there is no server to render `useHead`, so that
           * link was injected by JavaScript after the bundle booted. The page
           * therefore painted the bundle's built-in dark, downloaded the theme
           * stylesheet, and only then became the site's theme — measured at
           * several hundred milliseconds of the wrong colours.
           *
           * `app.head` is baked into the HTML Nuxt generates for BOTH shapes, so
           * the link is render-blocking in both and the first paint is already
           * the right one. Paired with the site default being emitted under a
           * bare `:root`, no JavaScript is involved in getting the colours right
           * at all.
           */
          rel: 'stylesheet',
          href: '/api/theme.css',
          // After `entry.css`, so a theme block wins over the built-in `:root`
          // declarations it is meant to override. Capo gives stylesheets 60 by
          // default; the built-ins live in the bundle, so this has to sort later.
          tagPriority: 65,
        },
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
