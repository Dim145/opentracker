/**
 * i18n-format — branche les formateurs de `utils/format.ts` sur la langue de
 * la requête en cours.
 *
 * Universel, pas `.client`. Le pendant client existait déjà (`i18n-user`
 * appelle `setFormatLocale`), mais rien ne le faisait côté serveur : tout le
 * rendu SSR sortait donc en anglais, et une page française affichait
 * « yesterday » dans sa colonne ÂGE jusqu'à ce que l'hydratation la réécrive.
 * Sans JavaScript — ou pour un moteur d'indexation — elle restait anglaise.
 *
 * Le résolveur ne CAPTURE pas la langue : il la relit à chaque appel depuis le
 * contexte Nuxt courant. C'est ce qui le rend sûr en rendu serveur, où
 * plusieurs requêtes se partagent le même module et où une variable écrite par
 * requête ferait fuiter la langue d'un membre dans la page d'un autre.
 */
export default defineNuxtPlugin({
  name: 'i18n-format',
  enforce: 'post',
  setup() {
    setFormatLocaleSource(() => {
      const app = useNuxtApp() as {
        $i18n?: { locale?: { value?: string } };
      };
      return app?.$i18n?.locale?.value || 'en';
    });
  },
});
