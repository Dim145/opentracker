import { defineNitroConfig } from 'nitropack/config';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineNitroConfig({
  compatibilityDate: '2025-07-15',
  srcDir: '.',
  scanDirs: ['routes', 'middleware', 'plugins', 'utils'],

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
