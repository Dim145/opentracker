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
    // Un fuseau qui n'est pas UTC, et qui change d'heure deux fois par an.
    //
    // Le conteneur de test tourne en UTC, où toute confusion entre heure locale
    // et heure UTC passe inaperçue : les gardes du couple
    // `isoToDatetimeLocal` / `datetimeLocalToIso` — écrites après une dérive de
    // deux heures par enregistrement sur la page d'un torrent — y sont
    // vertes quoi qu'on fasse. Ici, elles mesurent quelque chose.
    env: { TZ: 'Europe/Paris' },
  },
  /*
   * `import.meta.client` vaut vrai ici.
   *
   * Nuxt le remplace à la compilation ; Vite seul ne le connaît pas, donc sous
   * vitest il vaut `undefined` et tout garde `if (!import.meta.client) return`
   * sort avant d'avoir rien fait — un test qui passe en n'exécutant rien.
   * `useMessagingStream` est le premier module couvert qui en dépend, et c'est
   * la bonne valeur pour cette suite : elle ne teste que du code client, jamais
   * une branche de rendu serveur.
   */
  define: { 'import.meta.client': 'true', 'import.meta.server': 'false' },
  resolve: {
    alias: {
      '~': `${root}app`,
      '@': `${root}app`,
      '~~': root,
      '@@': root,
    },
  },
});
