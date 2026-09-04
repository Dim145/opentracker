/**
 * Un repli, et la case qui les ouvre tous.
 *
 * # Pourquoi une case globale existe
 *
 * Replier le NFO, les pistes et les fichiers fait passer le bas de page de
 * ~2000 px à 60 px — c'est la mesure qui a décidé la maquette. Mais un contenu
 * en `display: none` est invisible pour le `Ctrl+F` du navigateur, et une fiche
 * dont la recherche du navigateur ne trouve plus que le tiers visible est une
 * régression pour qui vit au `Ctrl+F`.
 *
 * On ne peut pas intercepter la recherche du navigateur. La contre-mesure est
 * donc une case unique : elle déplie TOUTES les sections d'un coup, et la
 * recherche retrouve 100 % du contenu. C'est le compromis de `mockup-tabs`,
 * transplanté ici.
 *
 * # Pourquoi `useState` et pas un `provide`
 *
 * Un `provide/inject` obligerait la page à envelopper ses sections dans un
 * fournisseur — donc à connaître le mécanisme. Ici la page pose la case où elle
 * veut, chaque repli lit le même état, et rien ne les relie dans le gabarit.
 * `useState` plutôt qu'un `ref` de module : le rendu serveur a besoin que
 * l'état soit sérialisé avec la page, sinon la première hydratation replie ce
 * que le serveur avait déplié.
 */

import type { ComputedRef } from 'vue';

/** L'état partagé : « tout est déplié ». */
export function useExpandAll() {
  return useState<boolean>('torrent-detail-expand-all', () => false);
}

export interface DisclosureState {
  /** Ouvert — soit par son propre bouton, soit parce que tout est déplié. */
  open: ComputedRef<boolean>;
  /** Ce que le bouton du repli appelle. Sans effet quand tout est déplié. */
  toggle: () => void;
  /** Vrai quand l'ouverture vient de la case globale : le bouton se désactive. */
  forced: ComputedRef<boolean>;
}

/**
 * Un repli qui obéit à la case globale.
 *
 * L'état local est conservé pendant que la case est cochée : la décocher rend à
 * chaque section l'état où le membre l'avait laissée, plutôt que de tout
 * refermer.
 */
export function useDetailDisclosure(defaultOpen = false): DisclosureState {
  const expandAll = useExpandAll();
  const local = ref(defaultOpen);

  return {
    open: computed(() => expandAll.value || local.value),
    toggle: () => {
      if (!expandAll.value) local.value = !local.value;
    },
    forced: computed(() => expandAll.value),
  };
}
