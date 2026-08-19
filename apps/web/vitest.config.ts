import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Frontend unit suite.
//
// It mounts no component and does not boot Nuxt: it covers the pure helpers
// in `app/utils`, which is where the logic that can be silently wrong lives —
// release-name parsing, MediaInfo reading, BBCode listing generation. Those
// modules import nothing from Nuxt, so no simulated environment is needed;
// mounting components would require `@nuxt/test-utils` and a simulated
// browser, for a far smaller return.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    clearMocks: true,
  },
  resolve: {
    alias: {
      '~': `${root}app`,
      '@': `${root}app`,
      '~~': root,
      '@@': root,
    },
  },
});
