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
    // Mêmes secrets factices que la suite unitaire : plusieurs modules
    // tirent `utils/settings` dans leur chaîne d'imports, qui construit le
    // client Redis au chargement. Les valeurs viennent de l'environnement
    // quand le harnais en fournit (`run-integration-tests.sh`), sinon on
    // retombe sur ces valeurs de test.
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
