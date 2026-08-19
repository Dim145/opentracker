/**
 * The handover between the upload page and the listing generator.
 *
 * Two directions of travel:
 *
 *   upload → listing   the `.torrent` already picked and the ids already
 *                      entered, so the user does not have to reselect their
 *                      file;
 *   listing → upload   the BBCode produced, which the upload page injects into
 *                      the editor on return.
 *
 * A `File` object does not serialise: this store lives in memory for the
 * duration of the browsing session. That is enough because the transfer happens
 * through internal navigation (`navigateTo`), with no reload. Opening
 * /torrents/fiche in a fresh tab simply starts from the selection step — hence
 * `hasTorrent`, which the page consults to decide where to begin.
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

  /** Destructive read: the listing must only be injected once. */
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
