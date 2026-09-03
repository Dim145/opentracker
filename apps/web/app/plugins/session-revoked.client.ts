/**
 * Renvoie proprement au formulaire de connexion quand la session courante a
 * été révoquée depuis un AUTRE appareil.
 *
 * Le bouton « déconnecter partout » des réglages incrémente
 * `users.session_epoch` ; `requireUserSession` compare cette valeur à celle
 * portée par le cookie et, si elles diffèrent, efface la session et répond
 * `401` avec `data.reason = 'session-revoked'`.
 *
 * L'appareil qui a cliqué est bien traité : la page des réglages le renvoie
 * elle-même vers `/auth/login?revoked=all` et il y lit une notice. Les
 * AUTRES appareils, eux, n'avaient rien. Le membre restait sur la page où il
 * se trouvait, et le premier appel qui suivait affichait l'échec brut — un
 * « Server Error » ou une liste vide selon l'endroit — alors que la cause
 * était connue, nommée par l'API, et parfaitement explicable.
 *
 * Pourquoi un plugin et pas une correction par page : il n'y a pas de couche
 * d'appel centralisée dans ce projet, les pages utilisent `useFetch` et
 * `$fetch` directement. Le seul point unique est l'instance globale de
 * `$fetch`, que l'on remplace ici par une copie porteuse d'un intercepteur.
 * `useFetch` s'appuie sur cette même instance, donc les deux voies sont
 * couvertes.
 *
 * Client seulement, et délibérément. Côté serveur un 401 pendant le rendu SSR
 * doit rester une erreur que la page traite : rediriger depuis un plugin
 * serveur remplacerait un rendu partiel par une navigation, pour toutes les
 * requêtes de tous les visiteurs partageant ce processus.
 */
export default defineNuxtPlugin({
  name: 'session-revoked',
  // Avant les autres : les plugins qui appellent l'API à l'amorçage
  // (`runtime-config`, `i18n-user`) doivent déjà passer par l'instance
  // interceptée, sinon une révocation constatée pendant le démarrage est
  // exactement le cas que l'on rate.
  enforce: 'pre',
  setup() {
    /*
     * Un seul renvoi, quoi qu'il arrive.
     *
     * Une page en porte facilement cinq ou six appels en parallèle. Tous
     * échouent au même instant avec le même motif, et sans ce garde chacun
     * déclencherait sa navigation — ce qui empile les entrées d'historique et,
     * pire, peut faire repartir une navigation alors que la précédente est en
     * cours.
     */
    let redirecting = false;

    const original = globalThis.$fetch;
    globalThis.$fetch = original.create({
      onResponseError({ response }) {
        if (response.status !== 401) return;

        // `createError({ data })` de h3 sérialise en
        // `{ statusCode, statusMessage, message, data }`, donc le motif est
        // imbriqué. On ne lit que celui-là : un 401 NU est le cas normal du
        // visiteur non connecté, et le renvoyer au login depuis n'importe
        // quelle page publique serait une régression, pas un correctif.
        const reason = (
          response._data as { data?: { reason?: string } } | undefined
        )?.data?.reason;
        if (reason !== 'session-revoked') return;

        if (redirecting) return;

        // Déjà sur le formulaire : rien à faire, et surtout pas une
        // navigation vers l'endroit où l'on se trouve.
        const route = useRoute();
        if (route.path.startsWith('/auth/')) return;

        redirecting = true;
        // `navigateTo` sans `await` : on est dans un intercepteur, la
        // promesse de l'appel d'origine doit continuer à rejeter pour que la
        // page ne reste pas suspendue sur un chargement qui n'aboutira pas.
        void navigateTo({
          path: '/auth/login',
          query: { revoked: 'remote' },
        });
      },
    }) as typeof original;
  },
});
