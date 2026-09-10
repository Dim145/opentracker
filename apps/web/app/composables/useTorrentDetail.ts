/**
 * Toutes les données de la page de détail d'un torrent, et ce qu'on en dérive.
 *
 * # Pourquoi ce fichier existe
 *
 * La page portait 813 lignes de `<script setup>` pour 907 lignes de gabarit.
 * Rien n'y était testable : chaque permission, chaque libellé dérivé, chaque
 * requête vivait dans le composant qui les affichait.
 *
 * # Ce qu'il corrige au passage
 *
 * La page faisait **sept `await` au niveau de `setup`**, et un commentaire y
 * affirmait que les requêtes annexes étaient faites ainsi « so a slow signature
 * lookup never blocks the page render ». C'était faux : `await useFetch()` au
 * niveau de `setup` est *exactement* ce qui fait attendre le rendu serveur. Le
 * premier octet partait après sept allers-retours.
 *
 * Ici, une seule requête bloque le rendu serveur — le détail, sans lequel il
 * n'y a pas de page. Les autres sont `lazy: true` : le rendu serveur ne les
 * attend pas, et chaque section dépendante se rend vide puis se remplit. C'est
 * ce que le commentaire d'origine décrivait, enfin implémenté.
 *
 * # Pourquoi cette fonction est SYNCHRONE
 *
 * Elle a d'abord été écrite `async`, avec `await useFetch()` pour le détail
 * puis les annexes derrière. Ça rendait **500** au rendu serveur, et seulement
 * là : `NUXT_E1001`.
 *
 * Le compilateur de Vue enveloppe chaque `await` de premier niveau d'un
 * `<script setup>` dans `withAsyncContext()`, qui rétablit l'instance du
 * composant après la reprise. Un fichier `.ts` ordinaire n'a pas ce
 * traitement : le premier `await` y perd le contexte Nuxt, et le `useFetch()`
 * suivant lève. La page d'origine faisait ses sept `await` DANS son
 * `<script setup>` — d'où sept allers-retours, mais aucune erreur.
 *
 * Rien n'est donc attendu ici. `useFetch` sans `lazy` fait déjà attendre le
 * rendu par la frontière `<Suspense>` ; aucun code de `setup` n'a besoin de la
 * valeur résolue, tout ce qui en dépend est un `computed`. Le typecheck et les
 * tests unitaires ne pouvaient pas voir le défaut : le client a un `nuxtApp`
 * global de repli, donc seul un rendu serveur réel le montre.
 */
import type { MediaMetadata } from '@trackarr/shared/media';

export interface TorrentComment {
  id: string;
  content: string;
  createdAt: string;
  author: { id: string; username: string } | null;
}

export interface CrossSeedItem {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  moderationStatus: string;
  createdAt: string;
  category: { id: string; name: string; slug: string; type: string | null } | null;
  uploader: { id: string; username: string } | null;
}

export interface FederatedCrossSeedItem {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  seeders: number;
  leechers: number;
  peerName: string;
  detailUrl: string | null;
  matchType: string;
}

export interface CrossSeedStats {
  otherTorrentCount: number;
  seederCount: number;
  leecherCount: number;
  uploadedShareBytes: string;
  totalUploadedBytes: string;
}

/** Ce que le membre doit encore à CE torrent. Absent si jamais téléchargé. */
export interface SeedObligation {
  downloaded: boolean;
  seedTime: number;
  requiredSeedTime: number;
  isHnr: boolean;
  isExempt: boolean;
  completedAt: string | null;
}

interface MediaMetadataResponse {
  enabled: boolean;
  found: boolean;
  metadata: MediaMetadata | null;
}

export function useTorrentDetail(hash: string) {
  const { user, loggedIn } = useUserSession();
  const { locale } = useI18n();
  /*
   * Capturé SYNCHRONEMENT, avant tout `then`. C'est ce qui permet à `ready`
   * plus bas de rappeler un `execute()` depuis une continuation de promesse :
   * `runWithContext` rétablit l'instance que la continuation n'a plus.
   */
  const nuxtApp = useNuxtApp();

  /* ── La seule requête bloquante ─────────────────────────────────────────── */
  // Pas de `await` : voir l'en-tête. Sans `lazy`, `<Suspense>` attend cette
  // requête avant de rendre, ce qui est exactement l'effet voulu.
  const detail = useFetch<Record<string, any>>(`/api/torrents/${hash}`);
  const { data: torrent, error, refresh: refreshTorrent } = detail;

  /* ── Les annexes, qui ne bloquent plus rien ─────────────────────────────── */
  const { data: crossSeeds } = useFetch<{ items: CrossSeedItem[]; total: number }>(
    `/api/torrents/${hash}/cross-seeds`,
    { lazy: true, default: () => ({ items: [], total: 0 }) },
  );

  const { data: supersessions, refresh: refreshSupersessions } = useFetch<{
    supersededBy: {
      infoHash: string;
      name: string;
      size: number;
      at: string;
      reason: string | null;
    } | null;
    supersedes: Array<{
      infoHash: string;
      name: string;
      size: number;
      supersedeReason: string | null;
    }>;
  }>(`/api/torrents/${hash}/supersessions`, {
    lazy: true,
    default: () => ({ supersededBy: null, supersedes: [] }),
  });

  const { data: crossSeedStats } = useFetch<CrossSeedStats>(
    `/api/torrents/${hash}/cross-seed-stats`,
    {
      lazy: true,
      default: () => ({
        otherTorrentCount: 0,
        seederCount: 0,
        leecherCount: 0,
        uploadedShareBytes: '0',
        totalUploadedBytes: '0',
      }),
    },
  );

  // L'état partagé, pas `useBranding()` : le layout l'a déjà chargé avant que
  // ce setup ne tourne, et `useBranding()` est asynchrone — l'attendre ici
  // reproduirait le NUXT_E1001 décrit en tête de fichier.
  const branding = useBrandingState();
  const federationEnabled = computed(() => !!branding.value?.federationEnabled);

  const { data: federatedCrossSeeds } = useFetch<{
    items: FederatedCrossSeedItem[];
    total: number;
    availability: { releases: number; seeders: number; leechers: number };
  }>(`/api/torrents/${hash}/cross-seeds-federated`, {
    lazy: true,
    // Une instance non fédérée n'a pas de partenaire : inutile de partir.
    immediate: federationEnabled.value,
    default: () => ({
      items: [],
      total: 0,
      availability: { releases: 0, seeders: 0, leechers: 0 },
    }),
  });

  /* ── L'obligation du membre, qui n'atteignait pas la page ───────────────── */
  const { data: obligation, refresh: refreshObligation, execute: fetchObligation } = useFetch<SeedObligation | null>(
    `/api/torrents/${hash}/my-obligation`,
    { lazy: true, immediate: false, default: () => null },
  );
  /*
   * Demandée seulement quand la fiche s'affiche pour de vrai.
   *
   * Les routes unitaires appliquent la visibilité du listing, où le contenu
   * adulte est EXCLU, tandis que la fiche le GARDE derrière un voile (200, avec
   * un écran dédié). Une page voilée n'a donc pas d'obligation à montrer, et la
   * demander produisait un 404 à chaque visite. Le tir est repoussé jusqu'à ce
   * que le torrent soit connu et non voilé.
   */
  watch(
    () => [loggedIn.value, !!torrent.value, !!torrent.value?.gatedAdult] as const,
    ([signedIn, loaded, isGated]) => {
      if (signedIn && loaded && !isGated) void fetchObligation();
    },
    { immediate: true },
  );

  /* ── Permissions ────────────────────────────────────────────────────────── */
  const isOwner = computed(
    () => !!user.value && torrent.value?.uploaderId === user.value.id,
  );
  const isStaff = computed(
    () => !!user.value && (user.value.isAdmin || user.value.isModerator),
  );
  const canEdit = computed(() => loggedIn.value && (isOwner.value || isStaff.value));
  const canDelete = canEdit;
  const canReport = computed(() => loggedIn.value && !!user.value);
  const canFavorite = canReport;

  /* ── Dérivés d'affichage ────────────────────────────────────────────────── */
  const gated = computed(() => !!torrent.value?.gatedAdult);

  /**
   * Le multiplicateur actif, ou rien.
   *
   * Délibérément aveugle à l'événement du site : un buff PAR TORRENT est ce que
   * cette page annonce, et mélanger les deux ferait afficher « freeleech » sur
   * chaque release pendant un événement global.
   */
  const buff = computed(() => {
    const t = torrent.value;
    if (!t || gated.value) return null;
    if (t.downloadMultiplier === undefined || t.uploadMultiplier === undefined) {
      return null;
    }
    if (t.multipliersUntil && new Date(t.multipliersUntil) <= new Date()) return null;
    const dl = t.downloadMultiplier as number;
    const ul = t.uploadMultiplier as number;
    if (dl === 100 && ul === 100) return null;
    const kind =
      dl === 0 && ul === 100 ? 'freeleech' : dl === 100 ? 'upload' : 'mixed';
    return { kind, dl, ul, until: (t.multipliersUntil as string | null) ?? null };
  });

  const buffPair = computed(() => {
    if (!buff.value) return '';
    const f = (p: number) => `${(p / 100).toLocaleString(locale.value)}×`;
    return `${f(buff.value.dl)} DL · ${f(buff.value.ul)} UL`;
  });

  const buffEndsIn = computed(() =>
    buff.value?.until ? formatUntil(buff.value.until, locale.value) : '',
  );

  /**
   * Le lien TMDb, qui accepte les deux formes stockées.
   *
   * La colonne porte tantôt `693134`, tantôt `tv/1399` — le préfixe est ce qui
   * distingue une série d'un film. Sans préfixe on tombe sur `/movie/`, que
   * TMDb redirige de lui-même vers le bon espace de noms.
   */
  const tmdbLink = computed(() => {
    const raw = torrent.value?.tmdbId as string | null | undefined;
    if (!raw) return null;
    const prefixed = raw.match(/^(movie|tv)\/(\d+)$/);
    if (prefixed) {
      return {
        href: `https://www.themoviedb.org/${prefixed[1]}/${prefixed[2]}`,
        label: prefixed[2]!,
      };
    }
    /*
     * Un identifiant NU est ambigu : TMDb a deux espaces de noms indépendants
     * (`/movie/{n}` et `/tv/{n}`) et le même entier résout dans les deux.
     * `normalizeTmdbId` le dit explicitement côté API — « bare; resolver
     * guesses ». Deviner « film » systématiquement envoyait sur un 404 toute
     * série dont l'identifiant a été saisi sans préfixe.
     *
     * L'ordre de préférence : le type que TMDb a RÉELLEMENT résolu (il est
     * dans la charge de métadonnées, donc il ne coûte rien), puis l'indice
     * tiré de la catégorie, puis « film » en dernier recours.
     */
    const resolved = metadata.value?.type;
    const hinted = deriveTypeHint(torrent.value?.category);
    const kind = resolved === 'tv' || hinted === 'tv' ? 'tv' : 'movie';
    return { href: `https://www.themoviedb.org/${kind}/${raw}`, label: raw };
  });

  /**
   * La clé de la page de groupe — « toutes les releases de cette œuvre ».
   *
   * `/torrents/group/{key}` existe depuis longtemps et cette page n'y renvoyait
   * jamais, alors que les trois identifiants nécessaires arrivent dans la même
   * charge utile. C'est la réponse au « laquelle de ces six je prends », déjà
   * construite, jamais reliée.
   */
  const groupKey = computed(() => {
    const t = torrent.value;
    if (!t || gated.value) return null;
    // Le préfixe `movie/` ou `tv/` reste. Il était retiré ici, et c'était un
    // bug : la clé de groupe du serveur est construite en SQL comme
    // `'tmdb:' || tmdb_id` (`torrentGroups.ts`), donc elle CONTIENT le
    // préfixe, la page `/torrents/group/[...key].vue` est un attrape-tout
    // précisément pour que la barre oblique passe dans l'URL, et le découpage
    // par saison teste `tmdb_id LIKE 'tv/%'`. Une clé rabotée ne résolvait
    // rien : `releaseCount: 0`, section des versions vide, lien vers une page
    // de groupe vide — sur tout torrent dont l'identifiant TMDb a été saisi
    // par URL, ce que le formulaire d'upload encourage.
    if (t.tmdbId) return `tmdb:${t.tmdbId}`;
    if (t.igdbId) return `igdb:${t.igdbId}`;
    if (t.openlibraryId) return `openlibrary:${t.openlibraryId}`;
    return null;
  });

  /** Le panneau de modération passe AU-DESSUS quand il attend une action. */
  const moderationOnTop = computed(() => {
    const s = gated.value ? null : torrent.value?.moderationStatus;
    return s === 'pending' || s === 'changes_requested';
  });

  /** Un CTA conditionnel : proposer une relance n'a de sens qu'à zéro seeder. */
  const canAskReseed = computed(
    () =>
      loggedIn.value &&
      !gated.value &&
      torrent.value?.stats?.seeders === 0 &&
      !supersessions.value?.supersededBy,
  );

  const showVolumeCard = computed(
    () => Number(BigInt(crossSeedStats.value?.totalUploadedBytes ?? '0')) > 0,
  );


  /* ── Métadonnées de l'œuvre ────────────────────────────────────────────── */
  /**
   * Reprise de l'ancienne page, sans son `await`.
   *
   * Le commentaire d'origine disait que cette requête était faite à part
   * « so a slow signature lookup never blocks the page render ». Elle était
   * `await`ée au niveau de `setup` — donc elle bloquait exactement ce qu'elle
   * prétendait épargner.
   *
   * `immediate` dépend du torrent, qui n'est pas encore là quand cette ligne
   * s'exécute : c'est `watch: [lookupParams]` qui la déclenche à l'arrivée du
   * détail. La carte d'identité se rend donc sans son affiche, puis avec.
   */
  function deriveTypeHint(
    cat:
      | { newznabId?: number | null; slug?: string; name?: string }
      | null
      | undefined
  ): 'movie' | 'tv' | 'game' | 'book' | undefined {
    const id = cat?.newznabId;
    if (typeof id === 'number') {
      if (id >= 5000 && id < 6000) return 'tv';
      if (id >= 2000 && id < 3000) return 'movie';
      // Newznab buckets 1xxx (Console games) and 4xxx (PC) both map
      // to IGDB. We treat them as the same `game` hint — IGDB indexes
      // every platform under one game id.
      if ((id >= 1000 && id < 2000) || (id >= 4000 && id < 5000)) return 'game';
      // 7xxx is the book/ebook/comic/magazine decade.
      if (id >= 7000 && id < 8000) return 'book';
    }
    const text = `${cat?.slug || ''} ${cat?.name || ''}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
    if (/\b(?:tv|seri|episod|saison|season|show|anime)/.test(text)) return 'tv';
    if (/\b(?:movie|film|cinema|cine)/.test(text)) return 'movie';
    if (/\b(?:game|games|jeu|jeux|console|playstation|xbox|nintendo|switch|pc-?game)/.test(text)) return 'game';
    if (/\b(?:book|ebook|e-book|epub|mobi|azw3|livre|livres|comics?|bd|manga|magazine|revue)/.test(text)) return 'book';
    return undefined;
  }
  
  const lookupParams = computed(() => {
    const t = torrent.value;
    if (!t) return null;
    const type = deriveTypeHint(t.category);
    // Prefer the source that matches the category hint when we have
    // multiple ids stored — a TV box with both a TMDb and an IGDB id
    // should hit TMDb, a book box with both an Open Library and TMDb
    // id should hit Open Library, and so on.
    if (type === 'book' && t.openlibraryId) {
      return { source: 'openlibrary', id: t.openlibraryId, type };
    }
    if (type === 'game' && t.igdbId) {
      return { source: 'igdb', id: t.igdbId, type };
    }
    if (t.tmdbId) return { source: 'tmdb', id: t.tmdbId, type };
    if (t.imdbId) return { source: 'imdb', id: t.imdbId, type };
    if (t.tvdbId) return { source: 'tvdb', id: t.tvdbId, type };
    if (t.igdbId) return { source: 'igdb', id: t.igdbId, type };
    if (t.openlibraryId)
      return { source: 'openlibrary', id: t.openlibraryId, type };
    return null;
  });
  
  const {
    data: metadataResponse,
    status: metadataStatus,
    execute: executeMetadata,
  } = useFetch<MediaMetadataResponse>(
    '/api/metadata/lookup',
    {
      // useFetch refetches when reactive query params change.
      query: computed(() => {
        const p = lookupParams.value;
        if (!p) return {};
        const out: Record<string, string> = { source: p.source, id: p.id };
        if (p.type) out.type = p.type;
        return out;
      }),
      // Skip the call entirely when there's nothing to look up — saves
      // the 503 response when the operator hasn't set TMDB_API_KEY.
      immediate: !!lookupParams.value,
      watch: [lookupParams],
      // Don't surface a 5xx to the page error boundary; the metadata
      // card just won't render and the rest of the page works.
      onResponseError({ response }) {
        if (response.status === 503) return;
      },
    }
  );
  
  const metadata = computed(
    () => metadataResponse.value?.metadata ?? null
  );

  /**
   * « On ne sait pas encore », par opposition à « il n'y a rien ».
   *
   * `immediate` est faux au montage — la requête dépend du torrent, qui n'est
   * pas résolu à cet instant — donc le statut vaut `idle` puis `pending`. Les
   * deux veulent dire la même chose pour la carte d'identité : une recherche
   * est attendue et n'a pas répondu. Sans cette distinction, la carte
   * affirmait « Sans affiche » sur toute page dont l'œuvre est connue, le
   * temps d'un aller-retour.
   */
  const metadataPending = computed(
    () =>
      !!lookupParams.value &&
      (metadataStatus.value === 'idle' || metadataStatus.value === 'pending'),
  );

  /**
   * Ce que la PAGE attend, dans son propre `<script setup>`.
   *
   * Le détail, puis la recherche de métadonnées — dans cet ordre, parce que la
   * seconde a besoin des identifiants que porte le premier. Rien n'est attendu
   * ICI : un `await` dans ce fichier perdrait le contexte Nuxt (voir l'en-tête).
   * La page, elle, est un `<script setup>` : le compilateur de Vue y enveloppe
   * l'attente et rétablit l'instance.
   *
   * Pourquoi attendre l'affiche alors que le reste est en `lazy` : sans ça
   * elle arrive APRÈS l'hydratation, et le serveur a déjà écrit le substitut
   * « Sans affiche » à sa place — un `<div>` que le client remplace par un
   * `<img>`. Vue compte ça comme une non-concordance d'hydratation, à chaque
   * chargement de chaque page dont l'œuvre est connue, et l'affiche apparaît
   * en sautant. Le coût réel est faible : `/api/metadata/lookup` sert depuis
   * Redis (TTL positif ET négatif), donc seule la toute première visite d'une
   * œuvre paie l'aller-retour vers TMDb.
   *
   * `runWithContext` n'est pas une précaution : sans lui, `execute()` appelé
   * depuis une continuation de promesse lève `NUXT_E1001` — la continuation
   * n'est plus dans le contexte Nuxt, exactement comme le code après un
   * `await` dans un `.ts`. Le premier jet enveloppait l'appel d'un
   * `.catch(() => undefined)`, qui a AVALÉ cette erreur : la page rendait 200
   * sans affiche, et la seule trace était un `[NUXT_E1001]` dans les journaux
   * du conteneur. Le `catch` ci-dessous journalise pour cette raison — une
   * requête qui échoue vraiment (503 sans clé TMDb) n'arrive pas ici, elle
   * atterrit dans `error` sans rejeter.
   */
  const ready = Promise.resolve(detail)
    .then(() =>
      nuxtApp.runWithContext(() =>
        lookupParams.value ? executeMetadata() : undefined,
      ),
    )
    .catch((err) => {
      console.warn('[torrent-detail] la recherche de métadonnées a rejeté :', err);
      return undefined;
    });

  /** Le fil complet, pas la première page : ce que le sommaire annonce. */
  const commentCount = computed<number>(() => {
    const t = torrent.value as { commentCount?: number; comments?: unknown[] } | null | undefined;
    return t?.commentCount ?? t?.comments?.length ?? 0;
  });
  const comments = computed<TorrentComment[]>(
    () => (gated.value ? [] : (torrent.value?.comments ?? [])) as TorrentComment[],
  );

  return {
    // données
    torrent,
    error,
    comments,
    commentCount,
    crossSeeds,
    supersessions,
    crossSeedStats,
    federatedCrossSeeds,
    obligation,
    refreshObligation,
    metadata,
    metadataPending,
    ready,
    // contexte
    user,
    loggedIn,
    federationEnabled,
    // permissions
    isOwner,
    isStaff,
    canEdit,
    canDelete,
    canReport,
    canFavorite,
    // dérivés
    gated,
    buff,
    buffPair,
    buffEndsIn,
    tmdbLink,
    groupKey,
    moderationOnTop,
    canAskReseed,
    showVolumeCard,
    // actions
    refreshTorrent,
    refreshSupersessions,
  };
}
