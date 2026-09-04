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
  },
);

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
 * Le décor de l'œuvre — la seule donnée riche que la charge TMDb contenait et
 * que personne ne regardait.
 *
 * `backdropUrl` arrive dans `MediaMetadata` depuis toujours et n'était rendu
 * nulle part. Il devient un lavis DERRIÈRE l'affiche, masqué avant d'atteindre
 * le texte : la carte gagne une atmosphère propre à la release au lieu d'un
 * aplat gris de plus, sans qu'aucune lettre ne change de fond.
 */
const backdropUrl = computed(() => props.media?.backdropUrl || null);

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
  <div class="idc">
    <!-- L'affiche, ou ce qui en tient la place. `role="img"` avec un nom :
         le substitut est une information ("il n'y a pas d'affiche"), pas une
         décoration à masquer. -->
    <!-- Décoratif : l'information est déjà dans le titre et l'affiche. -->
    <div
      v-if="backdropUrl"
      class="idc-wash"
      :style="{ backgroundImage: `url(${backdropUrl})` }"
      aria-hidden="true"
    />
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
    <div
      v-else
      class="idc-poster idc-poster--empty"
      role="img"
      :aria-label="$t('torrents.detail.identity.posterUnavailable')"
    >
      <Icon name="ph:film-slate" class="idc-poster-glyph" aria-hidden="true" />
      <span class="idc-poster-note">{{ $t('torrents.detail.identity.noPoster') }}</span>
    </div>

    <div class="idc-head">
      <component :is="titleLevel" v-if="workTitle" class="idc-title">
        {{ workTitle }}
        <span v-if="year" class="idc-year">({{ year }})</span>
        <span v-if="originalTitle" class="idc-orig">
          {{ $t('torrents.detail.identity.originalTitle', { title: originalTitle }) }}
        </span>
      </component>

      <p v-if="score || meta.length" class="idc-meta">
        <!-- `role="img"` sur le groupe entier : sans rôle, un `aria-label` sur
             un `<span>` n'est pas exposé de façon fiable, et « 8,2 » sans son
             échelle ne dit rien. -->
        <span
          v-if="score"
          class="idc-score"
          role="img"
          :aria-label="$t('torrents.detail.identity.rating', { value: score })"
        >
          <Icon name="ph:star-fill" aria-hidden="true" />{{ score }}
        </span>
        <template v-for="(item, i) in meta" :key="item.id">
          <span v-if="i > 0 || score" class="idc-dot" aria-hidden="true">·</span>
          <span>{{ item.text }}</span>
        </template>
      </p>

      <!-- Aucune teinte de marque sur ces pastilles, et c'est une décision :
           l'ancienne version peignait le fond en `rgba(245, 197, 24, .12)`
           pour IMDb, ce qui suppose de figer trois couleurs hors du système
           de jetons et de vérifier chacune sur les deux thèmes. Le LIBELLÉ
           (« IMDb », « TMDb ») distingue déjà les fournisseurs, et il se lit
           partout. -->
      <ul
        v-if="mediaLinks.length"
        class="idc-ids"
        :aria-label="$t('torrents.detail.identity.mediaLinks')"
      >
        <li v-for="link in mediaLinks" :key="link.id">
          <!-- Sans lien, la pastille reste un `<span>` : un `<a>` sans `href`
               n'est pas focalisable et n'annonce rien, donc il promettrait une
               destination qu'il n'a pas. -->
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
      </ul>

      <div class="idc-relrow">
        <!-- Le bouton est HORS du titre. À l'intérieur, son `aria-label`
             entrerait dans le nom accessible du `<h1>` — « Dune… Copier le nom
             de la release » — et c'est ce nom que lit la table des titres. -->
        <div class="idc-reltop">
          <span class="idc-relkey">{{ $t('torrents.detail.identity.releaseName') }}</span>
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
        <component :is="nameHost" class="idc-relhost">
          <code
            class="idc-relname"
            :class="{ 'idc-relname--solo': !workTitle }"
            :title="releaseName"
          ><template v-for="(chunk, i) in nameChunks" :key="i">{{ chunk }}<wbr /></template></code>
        </component>

        <div v-if="infoHash" class="idc-hashrow">
          <div class="idc-reltop">
            <span class="idc-relkey">{{ $t('torrents.detail.infoHash') }}</span>
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
          <code class="idc-hash">{{ infoHash }}</code>
        </div>
      </div>

      <!-- Les chips de qualité et les pastilles de contexte (catégorie, tags,
           statut de modération) : alignées sur le titre, pas sur l'affiche.
           En slot parce que les pastilles de contexte dépendent de
           permissions que cette carte n'a pas à connaître. -->
      <slot name="chips" />
      <slot name="flags" />
      <slot />
    </div>
  </div>
</template>

<style scoped>
.idc {
  display: grid;
  /* La colonne suit l'affiche : elle était figée à 4,5 rem pendant que
     l'image grandissait, donc l'image débordait de sa piste. */
  grid-template-columns: clamp(4.5rem, 11vw, 8rem) minmax(0, 1fr);
  gap: 1rem;
  padding: 0.7rem 0.85rem;
  /* Le lavis est posé en absolu à l'intérieur ; sans conteneur ni découpe il
     déborderait des angles arrondis de la coquille. */
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

/* ── Le décor de l'œuvre ────────────────────────────────────────────────────
 *
 * Un lavis, pas une image de fond : 14 % d'opacité, en niveaux de gris pour
 * moitié, et éteint progressivement vers la droite. L'affiche est posée
 * dessus, donc la zone la plus chargée du lavis est celle qu'elle recouvre.
 *
 * Le masque s'arrête sur la COLONNE DE L'AFFICHE et non à un pourcentage de la
 * largeur. Premier jet : « transparent à 62 % », avec un commentaire affirmant
 * que le titre commençait après. Mesuré : dans un panneau de 468 px, le titre
 * commence à 115 px et le masque ne s'éteignait qu'à 322 — deux cent huit
 * pixels de texte sur le lavis. Un pourcentage ne veut pas dire la même chose
 * à 540 px et à 1280.
 *
 * Le texte le traverse donc quand même, un peu, et c'est acceptable pour une
 * raison mesurée et non supposée : au pire — un pixel blanc du décor à 14 % —
 * `--fg-strong` tient **12,27:1** en thème sombre, et **15,17:1** en clair
 * face à un pixel noir. Contre 18,42 et 21,00 sur la surface nue. On perd de
 * la marge, jamais le seuil.
 */
.idc-wash {
  position: absolute;
  inset: 0;
  z-index: -1;
  background-size: cover;
  background-position: center;
  opacity: 0.14;
  filter: grayscale(0.5) saturate(1.1);
  mask-image: linear-gradient(
    100deg,
    rgb(0 0 0) 0,
    rgb(0 0 0 / 0.5) calc(clamp(4.5rem, 11vw, 8rem) + 1rem),
    transparent calc(clamp(4.5rem, 11vw, 8rem) * 2.4)
  );
}
/* Pas d'image décorative pour qui a demandé le calme visuel : le lavis est de
   l'atmosphère, jamais de l'information. */
@media (prefers-reduced-motion: reduce) {
  .idc-wash {
    opacity: 0.08;
  }
}

.idc-poster {
  /*
   * La boîte était DÉJÀ réservée : `width` fixe et `aspect-ratio` étaient là,
   * donc aucun décalage de mise en page à l'arrivée du fichier — j'ai d'abord
   * cru le contraire en ne regardant que les attributs HTML absents. Les
   * attributs `width`/`height` ont tout de même été ajoutés sur la balise :
   * ils servent de repli si cette règle ne s'applique pas (courrier, lecteur
   * qui ignore la feuille).
   *
   * Ce qui était vrai : `loading="lazy"` sur une image AU-DESSUS de la ligne
   * de flottaison. Le navigateur retardait le plus gros élément du premier
   * écran — exactement celui qu'on veut voir en premier. `eager` et
   * `fetchpriority="high"` sur la balise.
   */
  /* 4,5 rem, c'était une vignette. Sur une page qui parle d'UNE release et qui
     dispose d'une vraie affiche, c'est la seule image de tout l'écran : elle a
     le droit d'être vue. Elle grandit avec la place et s'arrête à 8 rem, où
     elle équilibre le bloc de titre sans le dominer. */
  width: clamp(4.5rem, 11vw, 8rem);
  aspect-ratio: 2 / 3;
  box-shadow: var(--shadow-overlay);
  object-fit: cover;
  background-color: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
}

/* L'attente : le MÊME rectangle, sans affirmation. Un balayage lent plutôt
   qu'un texte — « Sans affiche » était faux tant que la requête n'avait pas
   répondu, et le mettre au futur (« recherche… ») dans la case le ferait
   clignoter à chaque page. Le libellé est sur `aria-label`, pour qui écoute. */
.idc-poster--loading {
  background: linear-gradient(
    100deg,
    rgb(var(--bg-inset)) 30%,
    rgb(var(--bg-hover)) 50%,
    rgb(var(--bg-inset)) 70%
  );
  background-size: 220% 100%;
  border: 1px solid rgb(var(--line-default));
  animation: idc-poster-sweep 1.4s ease-in-out infinite;
}
@keyframes idc-poster-sweep {
  from { background-position: 120% 0; }
  to { background-position: -20% 0; }
}
/* Une animation décorative n'a pas à tourner pour qui a demandé le calme. */
@media (prefers-reduced-motion: reduce) {
  .idc-poster--loading {
    animation: none;
  }
}

.idc-poster--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.15rem;
  /* Le même motif de fond que la page : le substitut se lit comme un trou
     dans la surface, pas comme une carte vide de plus. */
  background-image: var(--bg-pattern-image);
  background-size: 12px 12px;
  overflow: hidden;
  text-align: center;
  color: rgb(var(--fg-muted));
}
.idc-poster-glyph {
  font-size: 1.1875rem;
  line-height: 1;
}
.idc-poster-note {
  padding: 0 0.2rem;
  font-size: 0.5625rem;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  line-height: 1.2;
}

.idc-head {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.idc-title {
  margin: 0;
  /* `clamp()` en `rem` plutôt que trois points de rupture en pixels :
     `--ui-scale` ne s'applique qu'une fois, sur `html { font-size }`, donc une
     taille en `px` rend le réglage d'échelle de l'exploitant inerte. */
  /*
   * Au moins aussi gros que les titres de SES PROPRES sections.
   *
   * Mesuré avant : ce `h1` rendait à 21 px pendant que les en-têtes de section
   * de la même page montaient à 25,6 px, et que le `h1` de l'index qui mène
   * ici en fait 29,6. La page la plus profonde de la hiérarchie portait le
   * plus petit titre, et son titre était dominé par ses propres sous-titres.
   * Le maximum rejoint celui de `.h-page` (1,75 rem) — le titre de page du
   * reste du site — et le minimum reste au-dessus du plafond d'un en-tête de
   * section (1,55 rem) dès que la fenêtre le permet.
   */
  font-size: clamp(1.35rem, 2.8vw, 1.75rem);
  line-height: 1.15;
  font-weight: 700;
  letter-spacing: calc(-0.015em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
  overflow-wrap: anywhere;
}
.idc-year {
  font-weight: 500;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.idc-orig {
  display: block;
  margin-top: 0.1rem;
  font-size: 0.71875rem;
  font-weight: 500;
  letter-spacing: 0;
  /* `--fg-muted` et non `--fg-subtle`, parce que ce composant NE POSSÈDE PAS
     son fond : la page le pose sur `--bg-surface` aujourd'hui, et rien ne
     l'empêche de le poser sur `--bg-elevated` demain — où `--fg-subtle`
     tombe à 4,35:1. Le jeton serré ne s'emploie que sur un fond qu'on écrit
     soi-même. */
  color: rgb(var(--fg-muted));
}

.idc-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.3rem 0.5rem;
  margin: 0;
  font-size: 0.71875rem;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.idc-dot {
  /* Décoratif (`aria-hidden`), mais même règle que ci-dessus : le fond n'est
     pas le nôtre, donc pas de jeton serré. */
  color: rgb(var(--fg-muted));
}
.idc-score {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  font-weight: 700;
  /* Texte teinté sur la surface NEUTRE de la carte. Le voile chaud sous un
     texte chaud est la paire qui tombe sous 4,5:1 en thème clair. */
  color: rgb(var(--accent-warm-text));
}

.idc-relrow {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.15rem;
  min-width: 0;
}
.idc-reltop {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}
/* Le nom de release peut ÊTRE le titre de la page : la balise est calculée.
   Elle ne doit alors pas hériter d'une graisse de titre. */
.idc-relhost {
  min-width: 0;
  margin: 0;
  font-size: inherit;
  font-weight: inherit;
}
.idc-relkey {
  font-family: var(--font-mono);
  font-size: var(--label-sm, 0.5625rem);
  font-weight: var(--label-weight, 700);
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
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
/* Sans métadonnées — le cas COURANT, pas l'exception — ce bloc est le titre de
   la page. Il en prend la taille, sinon la page s'ouvre sur un `<h1>` de
   douze pixels. */
.idc-relname--solo {
  font-size: clamp(0.875rem, 1.8vw, 1rem);
  color: rgb(var(--fg-strong));
}

/* ── Les fiches publiques de l'œuvre ──────────────────────────────────── */
.idc-ids {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.idc-id {
  /* WCAG 2.5.8 : 24 px CSS au minimum pour une cible de pointeur, et ceci
     n'est pas un lien DANS une phrase, donc la dérogation « inline » ne
     s'applique pas. Mesuré à pastilles de fiches, 22 px avant. La hauteur seule change ; le texte
     reste où il est. */
  min-height: 1.5rem;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.15rem 0.4rem;
  /* En `rem`, comme tout le reste du fichier : `--ui-scale` ne s'applique
     qu'à `html { font-size }`, donc une taille en `px` — l'ancienne pastille
     portait un `text-[10px]` de Tailwind — rend le réglage d'échelle inerte. */
  font-size: var(--label-md, 0.625rem);
  font-weight: 700;
  letter-spacing: var(--label-tracking, calc(0.08em * var(--tracking-scale)));
  text-transform: uppercase;
  text-decoration: none;
  color: rgb(var(--fg-default));
  background-color: rgb(var(--bg-inset));
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
.idc-id-out {
  font-size: 0.625rem;
  color: rgb(var(--fg-muted));
}
/* Rien de cliquable ici (voir `mediaLinks`) : ni curseur de lien, ni survol. */
.idc-id--flat {
  cursor: default;
}

/* ── L'infohash, la seconde désignation ───────────────────────────────── */
.idc-hashrow {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: 0.3rem;
  min-width: 0;
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
  /* 40 caractères en SHA-1, 64 en BEP 52, et aucun espace : sans coupe
     partout, la chaîne déborde de la colonne au lieu de passer à la ligne. */
  word-break: break-all;
  /* Comme le nom de release juste au-dessus : un clic prend tout le hash. */
  user-select: all;
  cursor: text;
}

@media (max-width: 767px) {
  .idc {
    grid-template-columns: 3.5rem minmax(0, 1fr);
    gap: 0.6rem;
    padding: 0.65rem;
  }
  .idc-poster {
    width: 3.5rem;
  }
}
</style>
