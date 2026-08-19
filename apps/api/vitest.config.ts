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
    // Certains modules par ailleurs purs — `bonusEarning`, par exemple —
    // tirent `utils/settings` dans leur chaîne d'imports, qui construit le
    // client Redis au chargement du module et exige ses secrets. Plutôt que
    // de remanier le graphe d'imports pour les tests, on fournit ici des
    // valeurs manifestement factices : rien ne se connecte, les options sont
    // seulement bâties. Les longueurs respectent les minimums exigés en
    // production (32 caractères), sinon la validation refuse au chargement.
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
