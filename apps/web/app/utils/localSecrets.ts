/**
 * Ce que le navigateur garde de vous, et qui doit partir avec la session.
 *
 * Trois choses vivent dans le stockage local d'un membre, et aucune n'était
 * effacée à la déconnexion :
 *
 *  - `trackarr.identity.key` — la clé privée Ed25519 de l'identité portable.
 *    C'est la plus grave : `identityKey.forget()` existait et n'avait AUCUN
 *    appelant. Sur un profil de navigateur partagé, la personne suivante
 *    héritait de la clé qui signe les documents d'identité fédérés du membre
 *    précédent. Elle reste délibérément exportable — `PortableIdentity.vue`
 *    propose de la télécharger à tout moment, c'est le sens de « portable » —
 *    donc l'exposition à un XSS sur l'origine est inhérente au dispositif ;
 *    ce qui ne l'est pas, c'est qu'elle survive à la déconnexion.
 *  - `trackarr.draft.*` — les brouillons de sujets, de réponses, de
 *    commentaires et de tickets.
 *  - la carte des brouillons de messages privés, écrite par `messages.vue`.
 *
 * Appelé depuis `useUserSession().clear()`, le seul point par lequel passent
 * les quatre chemins de déconnexion de l'application (le magasin `user`, la
 * palette de commandes, la page de réglages, la mise en page). Y mettre la
 * purge plutôt que dans les quatre est ce qui garantit qu'un cinquième chemin
 * ajouté demain ne l'oubliera pas.
 *
 * Tout est gardé : un navigateur en navigation privée ou un réglage qui bloque
 * les données de site fait lever l'accesseur lui-même, et une déconnexion ne
 * doit jamais échouer pour cette raison.
 */

/** Les préfixes à purger. Un préfixe, pas une liste de clés : les brouillons
 *  portent un identifiant variable. */
const PURGE_PREFIXES = ['trackarr.identity.', 'trackarr.draft.'];

/** Les clés exactes à purger, pour ce qui ne suit pas la convention de
 *  nommage. `messages.vue` a choisi les deux-points. */
const PURGE_KEYS = ['trackarr:message-drafts'];

export function purgeLocalSecrets(): void {
  if (typeof window === 'undefined') return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (PURGE_KEYS.includes(key) || PURGE_PREFIXES.some((p) => key.startsWith(p))) {
        doomed.push(key);
      }
    }
    // En deux temps : retirer pendant qu'on énumère décale les index.
    for (const key of doomed) window.localStorage.removeItem(key);
  } catch {
    /* stockage indisponible : rien à purger */
  }
}
