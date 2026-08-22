import { defineNitroConfig } from 'nitropack/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineNitroConfig({
  compatibilityDate: '2025-07-15',
  srcDir: '.',

  // Nitro regenerates .nitro/types/tsconfig.json on every `prepare`, and that
  // is the config `pnpm typecheck` runs against — so the strictness has to be
  // declared here rather than edited into the generated file.
  //
  // strictNullChecks only. Full `strict` additionally turns on
  // noImplicitAny/strictFunctionTypes and friends, which this codebase does not
  // satisfy yet; the null checking is the part that catches bugs rather than
  // style. Enabling it surfaced 47 findings, all fixed — among them a federated
  // inbound path that dereferenced a possibly-null config, two notifications
  // handed a null recipient id when the author's account was gone, and a
  // session-id helper that could hand back `undefined` and quietly disable the
  // fresh-auth window.
  typescript: {
    tsConfig: {
      compilerOptions: {
        strictNullChecks: true,
      },
    },
  },
  scanDirs: ['routes', 'middleware', 'plugins', 'utils', 'redis'],

  // esbuild target. Nitro's default is `es2019` — far older than what
  // we actually run, and old enough to refuse BigInt literal syntax
  // (`0n` / `1024n`) at parse time even though the runtime supports
  // them fine. Pinning to `node24` matches the production runtime
  // (distroless `gcr.io/distroless/nodejs24-debian13:nonroot`, see
  // apps/api/Dockerfile) and unlocks every ES2025 feature V8 13.6
  // ships — iterator helpers, Set methods (`union` / `intersection` / …),
  // `Promise.try`, `RegExp.escape`, JSON modules. Targeting a Node
  // version rather than an ES year is the recommended idiom for
  // server-only bundles since esbuild keeps a per-runtime feature
  // table that accounts for V8-specific quirks.
  esbuild: {
    options: {
      target: 'node24',
    },
  },

  // Keep the legacy `~~/...` and `~/...` aliases working; they point at the
  // app root so existing route imports don't all need rewriting.
  alias: {
    '~~': root,
    '~': root,
  },

  runtimeConfig: {
    databaseUrl: (() => {
      const baseUrl =
        process.env.DATABASE_URL ||
        'postgres://tracker:tracker@localhost:5432/trackarr';
      if (
        process.env.NODE_ENV === 'production' &&
        !baseUrl.includes('sslmode=')
      ) {
        return (
          baseUrl + (baseUrl.includes('?') ? '&' : '?') + 'sslmode=require'
        );
      }
      return baseUrl;
    })(),
    redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
    sessionPassword: process.env.NUXT_SESSION_SECRET || '',
    public: {
      // Tracker URLs are read at runtime from NUXT_PUBLIC_TRACKER_*_URL env vars.
      trackerHttpUrl: 'http://localhost:8080/announce',
      trackerUdpUrl: 'udp://localhost:8081/announce',
      trackerWsUrl: 'ws://localhost:8082',
    },
  },

  // The tracker has been split out into its own service (apps/tracker).
  // We don't bundle the tracker plugin here.
  externals: {
    inline: [],
    external: [
      'node-datachannel',
      'webrtc-polyfill',
      '@thaunknown/simple-peer',
      'bittorrent-tracker',
      'webtorrent',
    ],
  },
});
