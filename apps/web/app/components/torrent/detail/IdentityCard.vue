<script setup lang="ts">
import type { MediaMetadata } from '@trackarr/shared/media';

/**
 * Qu'est-ce que c'est, et de quelle release parle-t-on.
 *
 * # L'affiche est un cas d'absence, pas un cas de présence
 *
 * `posterUrl` arrive à `null` en routine : l'exploitant n'a pas de clé TMDb,
 * le fournisseur ne connaît pas l'œuvre, ou la catégorie n'a pas de
 * fournisseur du tout. Un `<img>` sans `src` laisse un rectangle cassé, et un
 * `v-if` sans repli laisse la grille se refermer et le titre glisser de 4,5 rem
 * vers la gauche — deux pages du même site qui ne se ressemblent pas. Le
 * substitut est donc un OBJET dessiné, à la même taille, qui dit ce qui manque.
 *
 * # Le nom de release est un objet de première classe
 *
 * Pas une ligne de sous-titre : un bloc mono, sélectionnable d'un seul clic
 * (`user-select: all`), copiable d'un bouton, et coupé aux séparateurs.
 * `overflow-wrap: anywhere` seul coupe au milieu d'un mot — `TSUNDE` / `RE` —
 * ce qui rend un nom illisible exactement là où il faut le comparer à un
 * autre. Un `<wbr>` après chaque `.`, `_` et `-` donne au navigateur les
 * points de coupe légitimes, et il n'en cherche pas d'autres.
 *
 * Les segments sont rendus par `v-for`, pas par `v-html` : un nom de release
 * est une chaîne fournie par un membre, et la seule raison d'appeler
 * `v-html` ici serait d'y injecter les `<wbr>` — c'est-à-dire de reprendre à
 * la main un échappement que Vue fait déjà correctement.
 *
 * # L'infohash est la SECONDE désignation, pas une donnée technique de plus
 *
 * Il est posé sous le nom de release, dans le même bloc et avec le même
 * bouton de copie, parce que les deux désignent la même release — l'un pour
 * un humain, l'autre pour un client. Les séparer (le nom ici, le hash dans un
 * ruban de métadonnées trois écrans plus bas) obligeait à chercher deux fois
 * pour la même question, « de quelle release parle-t-on ».
 *
 * # Les fiches publiques appartiennent à l'ŒUVRE
 *
 * IMDb, TMDb, TVDB, IGDB, Open Library sont au même rang que la note, les
 * genres et le réalisateur : des faits sur l'œuvre, qu'on consulte en
 * regardant l'affiche et le titre. Ils sont donc juste sous la ligne de méta,
 * et pas avec l'uploadeur ou les étiquettes, qui parlent de la PUBLICATION.
 */
const props = withDefaults(
  defineProps<{
    /** Le nom de release. Toujours présent, c'est l'identité du torrent. */
    releaseName: string;
    /** Les métadonnées de l'œuvre. `null` est le cas courant, pas l'exception. */
    media?: MediaMetadata | null;
    /**
     * Le titre à afficher quand aucun fournisseur n'a répondu. La page y met
     * en général le titre nettoyé du torrent ; sans rien, le nom de release
     * devient lui-même le titre de la page.
     */
    fallbackTitle?: string | null;
    /** `h1` sur la page de détail, `h2` partout ailleurs. */
    titleLevel?: 'h1' | 'h2';
    /**
     * La recherche de métadonnées est encore en vol.
     *
     * Sans ce drapeau, `media: null` couvre DEUX états très différents — « il
     * n'y a pas d'affiche » et « on ne sait pas encore » — et la carte
     * affirmait le premier dans les deux cas. La recherche part côté client
     * (elle dépend du torrent, qui n'est pas encore résolu quand le composable
     * la déclare), donc le rendu serveur tombait systématiquement sur
     * « Sans affiche » avant de le démentir une demi-seconde plus tard.
     */
    mediaPending?: boolean;
    /**
     * L'infohash de la release. 40 caractères en SHA-1, 64 en BEP 52.
     *
     * Optionnel parce que la carte sert aussi de bloc d'identité pour une
     * œuvre sans release précise ; absent, le bloc de hash ne se rend pas.
     */
    infoHash?: string | null;
    /** L'identifiant IMDb tel qu'il est stocké — préfixe `tt` compris. */
    imdbId?: string | null;
    /**
     * Le lien TMDb DÉJÀ dérivé, jamais l'identifiant brut.
     *
     * `normalizeTmdbId` préserve délibérément le préfixe quand l'uploadeur
     * colle une URL : la colonne porte tantôt `693134`, tantôt `tv/34114`.
     * Une URL construite ici à partir de la valeur brute casserait sur la
     * seconde forme, et c'est `useTorrentDetail` qui résout déjà les deux.
     */
    tmdbLink?: { href: string; label: string } | null;
    tvdbId?: string | null;
    igdbId?: string | null;
    openlibraryId?: string | null;
    /**
     * Le fil d'orientation au-dessus du titre : catégorie › œuvre › unité
     * (« Séries / Frieren / Saison 01 · Épisode 09 »). L'épisode n'apparaissait
     * que dans la barre d'unité du tableau des versions, 700 px plus bas ; on
     * ouvrait la fiche sans savoir DE QUOI on regardait la release. Chaque
     * maillon peut porter un lien — le catalogue filtré, la page du groupe.
     */
    crumbs?: ReadonlyArray<{ label: string; to?: string | null; minor?: boolean }> | null;
    /**
     * Propose « Mauvaise fiche ? » à côté des fiches publiques : la page émet
     * `report-metadata` et ouvre son signalement avec le motif prérempli.
     */
    canReport?: boolean;
  }>(),
  {
    media: null,
    fallbackTitle: null,
    titleLevel: 'h1',
    mediaPending: false,
    infoHash: null,
    imdbId: null,
    tmdbLink: null,
    tvdbId: null,
    igdbId: null,
    openlibraryId: null,
    crumbs: null,
    canReport: false,
  },
);

const emit = defineEmits<{ (e: 'report-metadata'): void; (e: 'tint', rgb: string | null): void }>();

const { t, locale } = useI18n();

const workTitle = computed(() => props.media?.title || props.fallbackTitle || null);
const year = computed(() => props.media?.year ?? null);

/** Le titre d'origine, seulement quand il APPORTE quelque chose. */
const originalTitle = computed(() => {
  const orig = props.media?.originalTitle;
  if (!orig || !workTitle.value) return null;
  return orig === workTitle.value ? null : orig;
});

const posterUrl = computed(() => props.media?.posterUrl || null);

/**
 * Rien à montrer de l'œuvre : ni affiche, ni titre, et pas de recherche en
 * cours. C'est le cas COURANT — musique, jeux, livres, tout ce que TMDb ne
 * connaît pas — et le héros le traitait comme une exception : une tuile
 * « Sans affiche » de 192 × 288 px, un bandeau uni de 192 px, et le nom de
 * release en titre d'affiche sur deux lignes, répété mot pour mot dans la
 * bande d'identité 40 px plus bas. Mesuré : ~480 px de héros pour zéro
 * information. Ici, la tuile disparaît, le bandeau se réduit à une entrée de
 * page, et le titre est celui que la page a su extraire du nom — ou rien.
 */
const plain = computed(
  () => !posterUrl.value && !props.mediaPending && !props.media?.title,
);

/**
 * Le décor de l'œuvre — la seule donnée riche que la charge TMDb contenait et
 * que personne ne regardait.
 *
 * `backdropUrl` arrive dans `MediaMetadata` depuis toujours et n'était rendu
 * nulle part. Il devient un lavis DERRIÈRE l'affiche, masqué avant d'atteindre
 * le texte : la carte gagne une atmosphère propre à la release au lieu d'un
 * aplat gris de plus, sans qu'aucune lettre ne change de fond.
 */
const backdropUrl = computed(() => props.media?.backdropUrl || null);
/** `url("…")` avec les guillemets et les barres obliques échappés : une URL
 *  n'écrit jamais elle-même la fin de sa fonction CSS. */
const cssUrl = (u: string) => `url("${u.replace(/[\\"]/g, '\\$&').replace(/[\n\r]/g, '')}")`;

/**
 * Le décor glisse un peu moins vite que la page.
 *
 * C'est le seul mouvement de la fiche, et le seul qui ait un sens ici : le
 * voile suggère une profondeur, le glissement la donne. Quatre garde-fous.
 * `prefers-reduced-motion` ne déplace rien. Sous 48 rem non plus : le bandeau
 * y est presque aussi haut que l'image, il n'y a rien à faire glisser sans
 * zoomer dedans. Rien ne se recalcule une fois le bandeau sorti de l'écran.
 * Et le glissement est borné à la marge d'image réservée au-dessus du cadre
 * (24 % de sa hauteur, voir `::before`) pour qu'aucun bord ne se découvre,
 * quelle que soit la vitesse.
 *
 * Pourquoi 24 % et pas plus : c'est ce qu'un décor 16:9 a au-dessus du cadrage
 * `center 28%` sur un bandeau de rapport 3,33 (30 vw de haut). Une marge plus
 * grande obligeait à cadrer plus bas au repos — la première version prenait
 * 35 %, et la tête de Subaru sortait du cadre sur Re:ZERO.
 *
 * Un `transform` sur une couche à part, posé une fois par image : le voile et
 * le bord haut ne bougent pas, la page ne recalcule aucune mise en page.
 */
/**
 * La couleur de l'œuvre.
 *
 * L'affiche est échantillonnée sur une toile de 12 × 18 : moyenne des pixels
 * pondérée par leur saturation, sans les noirs ni les blancs, puis ramenée à
 * une saturation et une luminosité bornées — une TEINTE, jamais une
 * luminosité, pour qu'elle se mélange pareil sur les deux thèmes. Frieren tire
 * vers le vert, Dune vers l'orangé. Elle ne touche que des surfaces
 * décoratives : le haut du voile, le cadre de la carte de décision.
 *
 * Les CDN d'affiches n'envoient pas d'en-tête CORS (mesuré sur TMDB : l'image
 * en mode `anonymous` ne charge pas, et sans lui la toile est souillée). Le
 * pixel passe donc par `/_media/sample`, une route de ce serveur qui ne relaie
 * que des images, depuis trois hôtes connus, vers nos propres pages.
 */
const tint = ref<string | null>(null);
function hsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
}
function rgbOf(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return [f(0), f(8), f(4)];
}
let alive = true;
onBeforeUnmount(() => { alive = false; });
function sampleTint(url: string) {
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    // Un composant démonté, ou une affiche remplacée pendant le chargement :
    // l'échantillon ne s'applique pas.
    if (!alive || posterUrl.value !== url) return;
    try {
      const c = document.createElement('canvas');
      c.width = 12; c.height = 18;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, 12, 18);
      const d = ctx.getImageData(0, 0, 12, 18).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const [, s, l] = hsl(d[i]!, d[i + 1]!, d[i + 2]!);
        if (l < 0.12 || l > 0.9) continue;
        const wt = s * s;
        r += d[i]! * wt; g += d[i + 1]! * wt; b += d[i + 2]! * wt; w += wt;
      }
      if (w < 0.5) return;
      const [h, s] = hsl(r / w, g / w, b / w);
      const [R, G, B] = rgbOf(h, Math.min(0.7, Math.max(0.45, s)), 0.5);
      tint.value = `${R} ${G} ${B}`;
      emit('tint', tint.value);
    } catch {
      /* toile souillée ou décodage refusé : la fiche reste sans teinte */
    }
  };
  img.src = `/_media/sample?src=${encodeURIComponent(url)}`;
}
onMounted(() => {
  watch(posterUrl, (u) => {
    tint.value = null;
    emit('tint', null);
    if (u) sampleTint(u);
  }, { immediate: true });
});

const band = ref<HTMLElement | null>(null);
let stopDrift: (() => void) | null = null;
onMounted(() => {
  const el = band.value;
  if (!el) return;
  // Lus à chaque image, pas une fois au montage : une fenêtre qu'on élargit
  // après le chargement gagne le glissement, une qu'on rétrécit le perd — et le
  // membre qui active la réduction des animations en cours de route est servi.
  const wide = window.matchMedia('(min-width: 48rem)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0;
  const tick = () => {
    frame = 0;
    if (!backdropUrl.value) return;
    if (!wide.matches || reduce.matches) {
      el.style.removeProperty('--idc-drift');
      return;
    }
    const h = el.offsetHeight;
    const y = window.scrollY;
    if (y > h * 1.2) return;
    el.style.setProperty('--idc-drift', `${Math.min(y * 0.3, h * 0.24).toFixed(1)}px`);
  };
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  tick();
  stopDrift = () => {
    window.removeEventListener('scroll', onScroll);
    if (frame) cancelAnimationFrame(frame);
  };
});
onBeforeUnmount(() => stopDrift?.());

/**
 * Le synopsis, borné à deux lignes par la feuille de style.
 *
 * Il était dans la charge depuis le début et n'était rendu nulle part. Deux
 * lignes suffisent à situer une œuvre qu'on ne connaît pas ; au-delà, c'est
 * la fiche TMDb qui fait ce travail, et elle est à un clic dans les pastilles
 * juste en dessous.
 */
const overview = computed(() => {
  const o = props.media?.overview?.trim();
  return o && o.length > 0 ? o : null;
});

/**
 * Les fiches publiques de l'œuvre, avec leur lien quand il en existe un.
 *
 * # Pourquoi chaque forme est testée avant de devenir une URL
 *
 * Un enregistrement antérieur aux normaliseurs peut porter n'importe quoi
 * dans ces colonnes, et concaténer ce n'importe quoi dans un `href` fabrique
 * au mieux un lien mort. Une forme inattendue laisse donc la pastille SANS
 * lien : l'identifiant reste affiché, parce que le rattachement est en
 * lui-même une information, il n'est simplement pas cliquable.
 *
 * # IGDB n'a AUCUN lien dérivable de ce qu'on stocke
 *
 * `igdb_id` est numérique (schéma, `torrents.igdb_id`) et les URLs d'igdb.com
 * ne portent que le slug — `normalizeIgdbId` le dit noir sur blanc : « IGDB
 * URLs always carry the slug, never the numeric id ». Il n'existe pas de
 * déréférenceur public par identifiant. Le slug n'apparaît que dans la
 * réponse du fournisseur, d'où `media.url` comme seule source du lien, et
 * une pastille sans lien quand la recherche n'a rien rapporté.
 */
const mediaLinks = computed(() => {
  const out: Array<{
    id: string;
    provider: string;
    value: string;
    href: string | null;
  }> = [];

  const imdb = props.imdbId?.trim();
  if (imdb) {
    out.push({
      id: 'imdb',
      provider: 'IMDb',
      value: imdb,
      href: /^tt\d+$/i.test(imdb) ? `https://www.imdb.com/title/${imdb}/` : null,
    });
  }

  if (props.tmdbLink) {
    out.push({
      id: 'tmdb',
      provider: 'TMDb',
      value: props.tmdbLink.label,
      href: props.tmdbLink.href,
    });
  }

  const tvdb = props.tvdbId?.trim();
  if (tvdb) {
    out.push({
      id: 'tvdb',
      provider: 'TVDB',
      value: tvdb,
      href: /^\d+$/.test(tvdb)
        ? `https://thetvdb.com/dereferrer/series/${tvdb}`
        : null,
    });
  }

  const igdb = props.igdbId?.trim();
  if (igdb) {
    out.push({
      id: 'igdb',
      provider: 'IGDB',
      value: igdb,
      href: props.media?.source === 'igdb' ? props.media.url || null : null,
    });
  }

  const ol = props.openlibraryId?.trim();
  if (ol) {
    // La colonne accepte trois formes (schéma) : un work id, un ISBN-13 ou
    // un ISBN-10 — et Open Library sert les deux espaces de noms sous des
    // chemins différents.
    let href: string | null = null;
    if (/^OL\d+W$/i.test(ol)) href = `https://openlibrary.org/works/${ol}`;
    else if (/^\d{10}$|^\d{13}$/.test(ol)) href = `https://openlibrary.org/isbn/${ol}`;
    out.push({ id: 'openlibrary', provider: 'Open Library', value: ol, href });
  }

  return out;
});

/**
 * L'élément qui porte le nom de release.
 *
 * Sans titre d'œuvre, le nom de release EST le titre de la page : il prend le
 * niveau de titre plutôt que de laisser la page sans `<h1>`. Avec un titre
 * d'œuvre, c'est un simple bloc — deux titres de même niveau sur une page en
 * font une page à deux sujets.
 */
const nameHost = computed(() => (workTitle.value ? 'div' : props.titleLevel));

/**
 * Le nom découpé aux séparateurs, séparateur inclus dans le segment qui le
 * précède.
 *
 * Le `<wbr>` doit venir APRÈS le point, sinon la coupe met le point en tête de
 * la ligne suivante — `.Atmos` — et un nom de release ne se lit plus.
 */
const nameChunks = computed(() => props.releaseName.split(/(?<=[._-])/));

const meta = computed(() => {
  const m = props.media;
  if (!m) return [];
  const out: Array<{ id: string; text: string }> = [];
  if (m.voteCount) {
    // `{ n }` nommé et non l'argument positionnel : c'est la forme que le
    // reste du dépôt utilise (`nfoMeta.lines`), et la seule qui interpole
    // aussi le nombre dans le message.
    out.push({
      id: 'votes',
      text: t('torrents.detail.identity.votes', { n: m.voteCount }, m.voteCount),
    });
  }
  if (m.runtime) {
    out.push({ id: 'runtime', text: formatRuntimeMinutes(m.runtime, locale.value) });
  }
  if (m.genres?.length) {
    out.push({ id: 'genres', text: m.genres.join(' · ') });
  }
  if (m.directors?.length) {
    out.push({
      id: 'directors',
      text: t('torrents.detail.identity.director', { names: m.directors.join(', ') }),
    });
  }
  return out;
});

/** La note, sur dix, avec une décimale — et rien du tout à zéro vote. */
const score = computed(() => {
  const v = props.media?.voteAverage;
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v.toLocaleString(locale.value, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
});

/**
 * QUEL bloc vient d'être copié, et non « quelque chose l'a été ».
 *
 * Il y a deux boutons pour deux textes ; un booléen partagé allumerait les
 * deux coches à la fois, ce qui affirme une copie qui n'a pas eu lieu.
 */
const copied = ref<'name' | 'hash' | null>(null);
let clearAt: ReturnType<typeof setTimeout> | null = null;

async function copy(what: 'name' | 'hash') {
  const text = what === 'name' ? props.releaseName : props.infoHash;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    copied.value = what;
    if (clearAt) clearTimeout(clearAt);
    clearAt = setTimeout(() => (copied.value = null), 1500);
  } catch {
    // Contexte non sécurisé, ou permission refusée. Les deux blocs restent
    // sélectionnables d'un clic — le bouton était un raccourci, pas le
    // seul chemin.
  }
}

onBeforeUnmount(() => {
  if (clearAt) clearTimeout(clearAt);
});
</script>

<template>
  <div class="idc" :class="{ 'idc--plain': plain, 'idc--tinted': tint }" :style="tint ? { '--work-tint': tint } : undefined">
    <!-- Le décor de l'œuvre, en BANDEAU et non en lavis dans une carte.
         Décoratif : l'information est déjà dans le titre et l'affiche. Sans
         décor, la bande reste — plus courte, unie — pour que l'affiche ait
         toujours quelque chose à chevaucher et que la page s'ouvre au même
         endroit d'une œuvre à l'autre. -->
    <div
      ref="band"
      class="idc-band"
      :class="{ 'idc-band--plain': !backdropUrl }"
      :style="backdropUrl ? { '--idc-backdrop': cssUrl(backdropUrl) } : undefined"
      aria-hidden="true"
    >
      <!-- La teinte de l'œuvre, sur sa propre couche pour pouvoir apparaître
           en fondu quand l'échantillon arrive ; le grain est le `::after`. -->
      <span class="idc-tint" />
    </div>

    <div class="idc-grid">
      <!-- L'affiche, ou ce qui en tient la place. `role="img"` avec un nom :
           le substitut est une information (« il n'y a pas d'affiche »), pas
           une décoration à masquer. -->
      <img
        v-if="posterUrl"
        class="idc-poster"
        :src="posterUrl"
        :alt="$t('torrents.detail.identity.posterAlt', { title: workTitle ?? releaseName })"
        width="500"
        height="750"
        loading="eager"
        fetchpriority="high"
        decoding="async"
      />
      <div
        v-else-if="mediaPending"
        class="idc-poster idc-poster--loading"
        role="img"
        :aria-label="$t('torrents.detail.identity.posterLoading')"
        aria-busy="true"
      />
      <!-- Le substitut ne se rend que quand une affiche était ATTENDUE : une
           œuvre connue sans image. Sans métadonnées du tout, une case vide de
           192 px ne dit rien que le titre ne dise déjà. -->
      <div
        v-else-if="!plain"
        class="idc-poster idc-poster--empty"
        role="img"
        :aria-label="$t('torrents.detail.identity.posterUnavailable')"
      >
        <Icon name="ph:film-slate" class="idc-poster-glyph" aria-hidden="true" />
        <span class="idc-poster-note">{{ $t('torrents.detail.identity.noPoster') }}</span>
      </div>

      <div class="idc-head">
        <nav
          v-if="crumbs?.length"
          class="idc-crumb"
          :aria-label="$t('torrents.detail.identity.crumbLabel')"
        >
          <!-- Le séparateur vit DANS le maillon : quand la ligne casse, la barre
               ouvre la suivante au lieu de pendre au bout de la précédente, et
               un maillon masqué emporte sa barre avec lui. -->
          <span
            v-for="(c, i) in crumbs"
            :key="i"
            class="idc-crumb-item"
            :class="{ 'idc-crumb-item--minor': c.minor }"
          >
            <span v-if="i > 0" class="idc-crumb-sep" aria-hidden="true">/</span>
            <NuxtLink v-if="c.to" :to="c.to" class="idc-crumb-link">{{ c.label }}</NuxtLink>
            <span v-else class="idc-crumb-here">{{ c.label }}</span>
          </span>
        </nav>
        <component :is="titleLevel" v-if="workTitle" class="idc-title">
          {{ workTitle }}
          <span v-if="year" class="idc-year">{{ year }}</span>
        </component>
        <p v-if="workTitle && originalTitle" class="idc-orig">
          {{ $t('torrents.detail.identity.originalTitle', { title: originalTitle }) }}
        </p>

        <p v-if="score || meta.length" class="idc-meta">
          <!-- `role="img"` sur le groupe entier : sans rôle, un `aria-label`
               sur un `<span>` n'est pas exposé de façon fiable, et « 8,2 »
               sans son échelle ne dit rien. -->
          <span
            v-if="score"
            class="idc-fact idc-score"
            role="img"
            :aria-label="$t('torrents.detail.identity.rating', { value: score })"
          >
            <Icon name="ph:star-fill" aria-hidden="true" />{{ score }}
          </span>
          <!-- Le point sépare depuis le CSS (`::before`) et non plus comme un
               élément à part : à 390 px sur Dune, la ligne cassait sur un
               point — « · Science Fiction · Adventure · » orphelin en tête et
               en queue de ligne. -->
          <span v-for="item in meta" :key="item.id" class="idc-fact">{{ item.text }}</span>
        </p>

        <p v-if="overview" class="idc-synopsis">{{ overview }}</p>

        <!-- Aucune teinte de marque sur ces pastilles, et c'est une décision :
             le LIBELLÉ (« IMDb », « TMDb ») distingue déjà les fournisseurs,
             et il se lit partout. -->
        <ul
          v-if="mediaLinks.length || (canReport && media)"
          class="idc-ids"
          :aria-label="$t('torrents.detail.identity.mediaLinks')"
        >
          <li v-for="link in mediaLinks" :key="link.id">
            <!-- Sans lien, la pastille reste un `<span>` : un `<a>` sans
                 `href` n'est pas focalisable et n'annonce rien. -->
            <component
              :is="link.href ? 'a' : 'span'"
              class="idc-id"
              :class="{ 'idc-id--flat': !link.href }"
              :href="link.href || undefined"
              :target="link.href ? '_blank' : undefined"
              :rel="link.href ? 'noopener noreferrer' : undefined"
              :title="
                link.href
                  ? $t('torrents.detail.identity.openOn', {
                      provider: link.provider,
                      id: link.value,
                    })
                  : $t('torrents.detail.identity.idNoLink', {
                      provider: link.provider,
                      id: link.value,
                    })
              "
            >
              <span class="idc-id-tag">{{ link.provider }}</span>
              <span class="idc-id-val">{{ link.value }}</span>
              <Icon
                v-if="link.href"
                name="ph:arrow-up-right-bold"
                class="idc-id-out"
                aria-hidden="true"
              />
            </component>
          </li>
          <!-- Sicario affichait la fiche de Nightcrawler et un membre n'avait
               aucun moyen de le dire. Le motif est prérempli : le signalement
               arrive au modérateur déjà qualifié. -->
          <li v-if="canReport && media">
            <button
              type="button"
              class="idc-id idc-id--flat idc-mismatch"
              :title="$t('torrents.detail.identity.wrongMatchTitle')"
              @click="emit('report-metadata')"
            >
              <Icon name="ph:flag-bold" class="idc-id-out" aria-hidden="true" />
              <span class="idc-mismatch-label">{{ $t('torrents.detail.identity.wrongMatch') }}</span>
            </button>
          </li>
        </ul>
      </div>
    </div>

    <!-- La bande d'identité : ce que l'humain et le client nomment, au même
         endroit, sous le titre — et pleine largeur, donc plus jamais une
         colonne vide à sa gauche. -->
    <div class="idc-strip">
      <!-- Le bouton change d'icône et d'infobulle, rien qu'un lecteur d'écran
           n'entende : la région vive dit « Copié » au moment où ça arrive. -->
      <span class="sr-only" role="status">{{ copied ? $t('common.copied') : '' }}</span>
      <div class="idc-strip-ids">
        <div class="idc-idrow">
          <!-- Le bouton est HORS du titre. À l'intérieur, son `aria-label`
               entrerait dans le nom accessible du `<h1>`. -->
          <span class="idc-relkey">{{ $t('torrents.detail.identity.releaseName') }}</span>
          <component :is="nameHost" class="idc-relhost">
            <code
              class="idc-relname"
              :class="{ 'idc-relname--solo': !workTitle }"
              :title="releaseName"
            ><template v-for="(chunk, i) in nameChunks" :key="i">{{ chunk }}<wbr /></template></code>
          </component>
          <button
            type="button"
            class="tool-btn tool-btn--sm"
            :aria-label="$t('torrents.detail.identity.copyName')"
            :title="copied === 'name' ? $t('common.copied') : $t('common.copy')"
            @click="copy('name')"
          >
            <Icon
              :name="copied === 'name' ? 'ph:check-bold' : 'ph:copy-bold'"
              aria-hidden="true"
            />
          </button>
        </div>

        <div v-if="infoHash" class="idc-idrow">
          <span class="idc-relkey">{{ $t('torrents.detail.infoHash') }}</span>
          <code class="idc-hash">{{ infoHash }}</code>
          <button
            type="button"
            class="tool-btn tool-btn--sm"
            :aria-label="$t('torrents.detail.identity.copyHash')"
            :title="copied === 'hash' ? $t('common.copied') : $t('common.copy')"
            @click="copy('hash')"
          >
            <Icon
              :name="copied === 'hash' ? 'ph:check-bold' : 'ph:copy-bold'"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <!-- Les pastilles de qualité : des faits sur CETTE release, donc dans sa
           bande d'identité et pas dans une rangée à part. En slot parce que
           l'analyse et les liens vers le catalogue appartiennent à la page. -->
      <div v-if="$slots.chips || $slots.provenance" class="idc-strip-foot">
        <div v-if="$slots.chips" class="idc-strip-chips">
          <slot name="chips" />
        </div>
        <!-- Qui l'a publiée : un fait sur CETTE release, donc dans sa bande
             d'identité, en bout de la ligne des pastilles — et plus une carte
             à part dans la colonne de décision, où il coûtait 85 px pour deux
             mots. -->
        <div v-if="$slots.provenance" class="idc-strip-prov">
          <slot name="provenance" />
        </div>
      </div>
      <slot name="flags" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
/* ── Pourquoi un bandeau ──────────────────────────────────────────────────
 *
 * Le décor TMDb était dans la charge depuis toujours et servait de lavis à
 * 14 % à l'intérieur d'une carte. La page s'ouvrait donc sur une boîte de plus,
 * de même poids que les douze suivantes, et l'œil n'avait nulle part où se
 * poser. Ici le décor est un BANDEAU qui sort du cadre de la page, fondu dans
 * son fond, et l'affiche chevauche son bord inférieur. C'est la seule audace de
 * la page ; tout le reste est calme.
 *
 * Les marges négatives valent exactement ce que `<main>` (`px-4`, `py-6`) et
 * `.release-page` (`--container-pad`, 1.25rem) ajoutent : aucun `vw`, donc
 * aucune barre de défilement comptée deux fois — c'est ce qui faisait déborder
 * sept décors « pleine largeur » sur ce site. Le bandeau s'arrête au bord de
 * `<main>`, soit la fenêtre jusqu'à 1400 px, puis un ruban centré.
 */
.idc {
  --idc-poster-w: clamp(6.5rem, 15vw, 12rem);
  /* La partie de l'affiche qui monte sur le bandeau. */
  --idc-overlap: clamp(4rem, 9vw, 7.5rem);
  display: block;
}

.idc-band {
  position: relative;
  overflow: hidden;
  height: clamp(13rem, 30vw, 24rem);
  margin: calc(-1 * (1.25rem + 1.5rem)) calc(-1 * (var(--container-pad) + 1rem)) 0;
  background-color: rgb(var(--bg-elevated));
  /* Le voile : de presque rien en haut à la couleur de la page en bas, pour
     que le décor ait un bord haut net (l'en-tête) et pas de bord bas. */
  mask-image: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0.72) 0%,
    rgb(0 0 0 / 0.42) 55%,
    transparent 100%
  );
}
/* En thème clair, un décor à pleine force écrase le titre qu'on pose dessus :
   le masque laisse passer moins. Mesuré sur l'affiche de Frieren, le blanc du
   ciel derrière un titre noir tenait 7,2:1 avec ce réglage, 4,1:1 sans. */
:root[data-theme='light'] .idc-band {
  mask-image: linear-gradient(
    to bottom,
    rgb(0 0 0 / 0.42) 0%,
    rgb(0 0 0 / 0.22) 55%,
    transparent 100%
  );
}
/* L'image sur sa propre couche. Sous 48 rem, elle EST le cadre : le cadrage
   `center 28%` d'origine, rien qui bouge. À partir de 48 rem, la couche est
   24 % plus haute que le cadre, calée en haut de l'image : au repos, le cadre
   montre exactement ce que `center 28%` montrait (mesuré à 1280 : les lignes
   92 à 476 de l'image contre 94 à 478 avant), et la marge du dessus est ce que
   le glissement consomme. Le masque est sur le cadre : le voile reste en place
   pendant que le décor bouge dessous. */
.idc-band::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: var(--idc-backdrop);
  background-size: cover;
  background-position: center 28%;
}
@media (min-width: 48rem) {
  .idc-band::before {
    inset: -24% 0 0 0;
    background-position: center top;
    transform: translate3d(0, var(--idc-drift, 0px), 0);
    will-change: transform;
  }
}
.idc-band--plain::before { display: none; }
/* Le grain : un bruit SVG à 6 % d'alpha, pour que le voile ne fasse pas de
   bandes sur les grands écrans. Invisible en tant que tel. */
.idc-band::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 160px 160px;
}
.idc-band--plain::after { display: none; }
/* La teinte : du haut vers rien à 70 % du bandeau, apparue en fondu. */
.idc-tint {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: linear-gradient(to bottom, rgb(var(--work-tint, 0 0 0) / 0.18), rgb(var(--work-tint, 0 0 0) / 0) 70%);
  opacity: 0;
  transition: opacity var(--dur-slow) var(--ease-standard);
}
.idc--tinted .idc-tint { opacity: 1; }
.idc-band--plain .idc-tint { display: none; }

/* ── L'entrée en scène : le décor se révèle, l'affiche monte, le titre suit ─
   Une seule séquence, sous 400 ms, et rien d'autre ne bouge au chargement.
   `backwards` sur le décor : à la fin, c'est sa règle propre (le glissement)
   qui reprend le `transform`, pas la dernière image de l'animation. */
@keyframes idc-develop {
  from { opacity: 0; transform: translate3d(0, var(--idc-drift, 0px), 0) scale(1.03); }
}
@keyframes idc-rise {
  from { opacity: 0; transform: translateY(0.5rem); }
}
.idc-band::before {
  animation: idc-develop var(--dur-slow) var(--ease-emphasis) backwards;
}
.idc-poster,
.idc-poster--empty {
  animation: idc-rise var(--dur-4) var(--ease-emphasis) both;
  animation-delay: calc(80ms * var(--motion-scale));
}
.idc-head,
.idc-strip {
  animation: idc-rise var(--dur-4) var(--ease-emphasis) both;
  animation-delay: calc(160ms * var(--motion-scale));
}
@media (prefers-reduced-motion: reduce) {
  .idc-band::before,
  .idc-poster,
  .idc-poster--empty,
  .idc-head,
  .idc-strip { animation: none; }
  .idc-tint { transition: none; }
}
@media (prefers-reduced-motion: reduce) {
  .idc-band::before { transform: none; }
}
/* Sans décor : une bande unie, plus courte. L'affiche a toujours un bord à
   chevaucher et la page s'ouvre au même endroit d'une œuvre à l'autre. */
.idc-band--plain {
  height: clamp(8rem, 16vw, 12rem);
  background-image: var(--bg-pattern-image);
  background-size: 12px 12px;
  mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.5), transparent);
}
@media (prefers-reduced-motion: reduce) {
  .idc-band {
    mask-image: linear-gradient(to bottom, rgb(0 0 0 / 0.35), transparent);
  }
}
/* Sans métadonnées : une entrée de page, pas un héros. Le bandeau devient un
   seuil de 7 à 9 rem, le titre — s'il y en a un — prend toute la largeur, et
   l'affiche n'a plus de place réservée puisqu'il n'y en aura pas. */
.idc--plain {
  --idc-overlap: 1.25rem;
}
.idc--plain .idc-band {
  height: clamp(7rem, 12vw, 9rem);
}
.idc--plain .idc-grid {
  grid-template-columns: minmax(0, 1fr);
}
.idc--plain .idc-title {
  font-size: clamp(1.5rem, 3vw, 2.25rem);
}

.idc-grid {
  display: grid;
  grid-template-columns: var(--idc-poster-w) minmax(0, 1fr);
  gap: clamp(1rem, 2.5vw, 2rem);
  align-items: end;
  margin-top: calc(-1 * var(--idc-overlap));
  position: relative;
}

.idc-poster {
  /* La boîte est réservée par `width` + `aspect-ratio` : aucun décalage de
     mise en page à l'arrivée du fichier. Les attributs `width`/`height` de la
     balise servent de repli si cette règle ne s'applique pas. `eager` et
     `fetchpriority="high"` : c'est la seule image du premier écran. */
  width: 100%;
  aspect-ratio: 2 / 3;
  display: block;
  object-fit: cover;
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-lg);
  /* Deux ombres : la portée, et un filet de la couleur de la page qui détache
     l'affiche du décor quel que soit le pixel derrière. */
  box-shadow:
    var(--shadow-overlay),
    0 0 0 1px rgb(var(--bg-base));
}
.idc-poster--loading {
  background: linear-gradient(
    100deg,
    rgb(var(--bg-inset)) 30%,
    rgb(var(--bg-hover)) 50%,
    rgb(var(--bg-inset)) 70%
  );
  background-size: 220% 100%;
  animation: idc-poster-sweep 1.4s ease-in-out infinite;
}
@keyframes idc-poster-sweep {
  from { background-position: 120% 0; }
  to { background-position: -20% 0; }
}
@media (prefers-reduced-motion: reduce) {
  .idc-poster--loading { animation: none; }
}
.idc-poster--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  background-image: var(--bg-pattern-image);
  background-size: 12px 12px;
  overflow: hidden;
  text-align: center;
  color: rgb(var(--fg-muted));
}
.idc-poster-glyph { font-size: 1.1875rem; line-height: 1; }
.idc-poster-note {
  padding: 0 0.2rem;
  font-size: 0.5625rem;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  line-height: 1.2;
}

.idc-head {
  min-width: 0;
  padding-bottom: 0.25rem;
}
.idc-head > * + * { margin-top: 0.45rem; }

/* Le titre de l'œuvre dans la police d'affiche du site — celle des titres de
   page (`/stats`) et des en-têtes de section, en italique comme eux. Il était
   en Inter à 21 px, plus petit que les sous-titres de sa propre page. */
.idc-title {
  margin: 0;
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: clamp(1.75rem, 3.6vw, 2.75rem);
  line-height: 1.04;
  letter-spacing: calc(-0.02em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
  text-wrap: balance;
  overflow-wrap: anywhere;
}
.idc-year {
  margin-left: 0.3em;
  font-style: normal;
  font-weight: 500;
  font-size: 0.6em;
  letter-spacing: 0;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.idc-orig {
  margin: 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}
.idc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.3rem 0;
  /* Chaque fait porte son point dans une marge gauche de 1.1rem ; la ligne
     est décalée d'autant et rognée d'autant : le point d'un fait qui ouvre une
     ligne tombe dans la zone rognée, celui d'un fait en milieu de ligne se
     lit entre ses voisins. Aucun point orphelin, quelle que soit la casse. */
  margin: 0 0 0 -1.1rem;
  clip-path: inset(0 0 0 1.1rem);
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.idc-fact {
  position: relative;
  padding-left: 1.1rem;
}
.idc-fact::before {
  content: '·' / '';
  position: absolute;
  left: 0.3rem;
  color: rgb(var(--fg-subtle));
}
.idc-score {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  font-weight: 700;
  color: rgb(var(--accent-warm-text));
}
.idc-synopsis {
  margin: 0;
  max-width: 62ch;
  font-size: 0.875rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.idc-crumb {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  font-family: var(--font-mono);
  font-size: var(--label-md, 0.625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.idc-crumb-link {
  /* WCAG 2.5.8 : 24 px de cible, dans une rangée qui ne fait que 10 px de
     texte. */
  display: inline-flex;
  align-items: center;
  min-height: 1.5rem;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color var(--dur-1) var(--ease-standard);
}
.idc-crumb-link:hover {
  color: rgb(var(--fg-strong));
}
.idc-crumb-item {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
}
.idc-crumb-sep { color: rgb(var(--fg-subtle)); }
/* À 390 px, « Frieren: Beyond Journey's End » prenait une ligne à lui seul —
   et le titre, 40 px plus bas, le répète en Fraunces. Sous 40 rem le fil garde
   la catégorie et l'unité, ce que le titre ne dit pas. */
@media (max-width: 40rem) {
  .idc-crumb-item--minor { display: none; }
}
/* Le dernier maillon — l'unité qu'on regarde — dans l'or du site. */
.idc-crumb-here { color: rgb(var(--accent-warm-text)); }

.idc-ids {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.idc-id {
  /* WCAG 2.5.8 : 24 px de cible au minimum. */
  min-height: 1.6rem;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.15rem 0.5rem;
  font-size: var(--label-md, 0.625rem);
  font-weight: 700;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  text-decoration: none;
  color: rgb(var(--fg-default));
  background-color: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  transition:
    background-color var(--dur-2) ease,
    border-color var(--dur-2) ease;
}
a.idc-id:hover {
  background-color: rgb(var(--bg-hover));
  border-color: rgb(var(--line-strong));
}
.idc-id-val {
  font-family: var(--font-mono);
  font-weight: 500;
  letter-spacing: 0;
  text-transform: none;
  color: rgb(var(--fg-muted));
}
.idc-id-out { font-size: 0.625rem; color: rgb(var(--fg-muted)); }
.idc-id--flat { cursor: default; }
/* Un bouton parmi des pastilles : même boîte, mais un libellé en minuscules et
   la couleur de commande — c'est une action, pas un fait sur l'œuvre. */
.idc-mismatch {
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  color: rgb(var(--fg-muted));
  font-family: var(--font-sans);
}
.idc-mismatch:hover {
  color: rgb(var(--fg-strong));
  background-color: rgb(var(--bg-hover));
  border-color: rgb(var(--line-strong));
}
.idc-mismatch-label { font-size: 0.6875rem; }

/* ── La bande d'identité ─────────────────────────────────────────────────── */
.idc-strip {
  margin-top: 1.25rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface));
  display: grid;
  gap: 0.75rem;
}
.idc-strip-ids {
  display: grid;
  gap: 0.5rem;
}
.idc-idrow {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 0.75rem;
  align-items: center;
}
.idc-relkey {
  grid-column: 1 / -1;
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
/* À partir de 640 px, la clé prend sa colonne et la valeur la suit. */
@media (min-width: 640px) {
  .idc-idrow { grid-template-columns: 7.5rem minmax(0, 1fr) auto; }
  .idc-relkey { grid-column: auto; }
}
.idc-relhost {
  min-width: 0;
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}
.idc-relname {
  display: block;
  padding: 0.4rem 0.5rem;
  font-family: var(--font-mono);
  font-size: clamp(0.75rem, 1.4vw, 0.84375rem);
  line-height: 1.35;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--accent-warm));
  border-radius: var(--radius-sm);
  overflow-wrap: anywhere;
  /* Un seul clic sélectionne le nom entier — ce qu'un membre vient chercher
     ici neuf fois sur dix. */
  user-select: all;
  cursor: text;
}
/* Sans métadonnées — le cas COURANT — ce bloc est le titre de la page. */
.idc-relname--solo {
  font-size: clamp(0.875rem, 1.8vw, 1rem);
}
.idc-hash {
  display: block;
  padding: 0.3rem 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  line-height: 1.35;
  letter-spacing: calc(0.02em * var(--tracking-scale));
  color: rgb(var(--fg-default));
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  /* 40 caractères en SHA-1, 64 en BEP 52, et aucun espace. */
  word-break: break-all;
  user-select: all;
  cursor: text;
}
.idc-strip-foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1.25rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgb(var(--line-default));
}
.idc-strip-chips {
  flex: 1 1 16rem;
  min-width: 0;
}
/* À droite tant que la ligne le permet ; en dessous des pastilles sinon. */
.idc-strip-prov {
  flex: 0 1 auto;
  margin-left: auto;
  min-width: 0;
}

@media (max-width: 767px) {
  .idc { --idc-poster-w: 5.5rem; --idc-overlap: 3rem; }
  /* Les deux pilules de commande flottent sur le haut du bandeau (jusqu'à
     ~84 px quand elles se replient sur deux lignes) : un bandeau court doit
     rester plus haut qu'elles, sinon le titre monte dessous. */
  .idc--plain { --idc-overlap: 0.5rem; }
  /* 8,5 rem et non 7 : à 375 px les deux pilules se replient sur deux lignes
     et descendent jusqu'à 165 px ; un bandeau de 7 rem posait le titre à 161.
     Mesuré, puis remesuré : 8,5 rem le pose à 185. */
  .idc--plain .idc-band { height: 8.5rem; }
  .idc-band { margin-left: calc(-1 * (var(--container-pad) + 1rem)); margin-right: calc(-1 * (var(--container-pad) + 1rem)); }
  .idc-strip { padding: 0.7rem 0.75rem; }
}
</style>