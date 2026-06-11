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
    // schemas). DB/Redis-backed paths get integration tests later.
    clearMocks: true,
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
