import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Integration suite: runs against a real Postgres (DATABASE_URL). Kept in
// a separate config + `*.itest.ts` glob so the default `pnpm test` (pure
// units, no DB) stays fast and dependency-free. Drive it with
// `pnpm test:integration` after pushing the schema to a throwaway DB.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/integration/**/*.itest.ts'],
    setupFiles: ['test/integration/setup.ts'],
    // Files share a single Postgres; run them one at a time so per-test
    // TRUNCATE in one file can't wipe another file's rows mid-flight.
    // (Concurrency *within* a test is explicit, via Promise.all.)
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
    // Same obviously-fake secrets as the unit suite: several modules pull
    // `utils/settings` into their import chain, and that builds the Redis
    // client at load time. Values come from the environment when the harness
    // provides them (`run-integration-tests.sh`), otherwise these test
    // defaults apply.
    env: {
      REDIS_PASSWORD: process.env.REDIS_PASSWORD ?? 'test-redis-password-not-a-real-one',
      REDIS_HOST: process.env.REDIS_HOST ?? 'trackarr-itest-redis',
      NUXT_SESSION_SECRET:
        process.env.NUXT_SESSION_SECRET ?? 'test-session-secret-0123456789abcdef',
      IP_HASH_SECRET:
        process.env.IP_HASH_SECRET ?? 'test-ip-hash-secret-0123456789abcdef',
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
