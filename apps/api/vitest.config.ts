import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// `~~` / `~` are the Nitro project-root aliases. Most of the current
// suite imports the units under test relatively (so no alias is needed),
// but wiring them here lets future tests import aliased modules the same
// way the runtime does.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // No global setup / DB: this suite covers pure, side-effect-free
    // units (SSRF range checks, XML builders, ban date math, zod
    // schemas, search helpers, bonus tier maths, panic crypto).
    clearMocks: true,
    // Some otherwise-pure modules — `bonusEarning`, for one — pull
    // `utils/settings` into their import chain, and that builds the Redis
    // client at module load time and demands its secrets. Rather than reshape
    // the import graph for the tests' sake, we supply obviously-fake values
    // here: nothing connects, the options are merely constructed. The lengths
    // respect the production minimums (32 characters), otherwise validation
    // refuses them at load time.
    env: {
      REDIS_PASSWORD: 'test-redis-password-not-a-real-one',
      NUXT_SESSION_SECRET: 'test-session-secret-0123456789abcdef',
      IP_HASH_SECRET: 'test-ip-hash-secret-0123456789abcdef',
      CHANNEL_ENCRYPTION_KEY:
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    },
  },
  resolve: {
    alias: {
      '~~': root,
      '~': root,
      '@@': root,
      '@': root,
    },
  },
});
