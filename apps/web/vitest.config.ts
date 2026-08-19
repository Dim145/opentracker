import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Suite unitaire du frontend.
//
// Elle ne monte aucun composant et ne démarre pas Nuxt : elle couvre les
// utilitaires purs de `app/utils`, qui sont là où vit la logique susceptible
// d'être fausse en silence — analyse d'un nom de release, lecture d'un
// MediaInfo, génération du BBCode d'une fiche. Ces modules n'importent rien
// de Nuxt, donc aucun environnement simulé n'est nécessaire ; monter des
// composants demanderait `@nuxt/test-utils` et un navigateur simulé, pour un
// gain bien moindre.
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
