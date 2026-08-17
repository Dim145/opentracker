/**
 * Passage de main entre la page d'upload et le générateur de fiche.
 *
 * Deux sens de circulation :
 *
 *   upload → fiche   le `.torrent` déjà choisi et les identifiants déjà
 *                    saisis, pour que l'utilisateur n'ait pas à
 *                    resélectionner son fichier ;
 *   fiche → upload   le BBCode produit, que la page d'upload injecte
 *                    dans l'éditeur au retour.
 *
 * Un objet `File` ne se sérialise pas : ce store vit en mémoire pour la
 * durée de la session de navigation. C'est suffisant parce que le
 * transfert se fait par navigation interne (`navigateTo`), sans
 * rechargement. Ouvrir /torrents/fiche dans un onglet neuf repart
 * simplement de l'étape de sélection — d'où `hasTorrent` que la page
 * consulte pour décider où démarrer.
 */
import { defineStore } from 'pinia';

export interface FicheHandoff {
  torrentFile: File | null;
  /** Nom de la release, déduit du .torrent ou saisi. */
  releaseName: string;
  imdbId: string;
  tmdbId: string;
  categoryId: string;
}

export const useFicheDraftStore = defineStore('ficheDraft', () => {
  const torrentFile = shallowRef<File | null>(null);
  const releaseName = ref('');
  const imdbId = ref('');
  const tmdbId = ref('');
  const categoryId = ref('');

  /** Résultat du générateur, en attente de récupération par l'upload. */
  const pending = ref<{ bbcode: string; nfo: string; title: string } | null>(null);

  const hasTorrent = computed(() => torrentFile.value !== null);

  function seedFromUpload(payload: Partial<FicheHandoff>) {
    if (payload.torrentFile !== undefined) torrentFile.value = payload.torrentFile;
    if (payload.releaseName !== undefined) releaseName.value = payload.releaseName;
    if (payload.imdbId !== undefined) imdbId.value = payload.imdbId;
    if (payload.tmdbId !== undefined) tmdbId.value = payload.tmdbId;
    if (payload.categoryId !== undefined) categoryId.value = payload.categoryId;
  }

  function handBack(payload: { bbcode: string; nfo: string; title: string }) {
    pending.value = payload;
  }

  /** Lecture destructive : la fiche ne doit être injectée qu'une fois. */
  function consumeResult() {
    const value = pending.value;
    pending.value = null;
    return value;
  }

  function reset() {
    torrentFile.value = null;
    releaseName.value = '';
    imdbId.value = '';
    tmdbId.value = '';
    categoryId.value = '';
    pending.value = null;
  }

  return {
    torrentFile,
    releaseName,
    imdbId,
    tmdbId,
    categoryId,
    pending,
    hasTorrent,
    seedFromUpload,
    handBack,
    consumeResult,
    reset,
  };
});
