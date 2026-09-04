<script setup lang="ts">
/**
 * « Laquelle de ces quatre je prends ? » — et de quoi, au fait.
 *
 * # Ce que la version précédente affirmait, et qui était faux
 *
 * Elle listait TOUTES les releases de l'œuvre, triées par taille, et posait
 * trois rangs d'usage dessus : la plus grosse « Image max », la plus petite
 * « Léger ». Deux pannes mesurées sur le catalogue :
 *
 *   1. Entre unités. La fiche de `Cats.Eye.S01` (`tmdb:tv/34114`) affichait
 *      `Cats.Eye.S02` étiquetée « Image max » et `S01` « Léger » : la saison 2
 *      présentée comme une meilleure variante de la saison 1. Deux contenus
 *      différents. La requête partait sans `scope`, et sans `scope` l'API
 *      répond `all` — les neuf releases de toutes les découpes confondues.
 *   2. Dans l'unité. `Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL` pèse
 *      42,9 Gio et `…S01.MULTi.1080p.BluRay.x265.FLAC` 22,4 Gio : le rang par
 *      taille couronnait le WEB-DL et traitait le BluRay de « Léger ». Les
 *      deux sont en 1080p, c'est la SOURCE qui les sépare.
 *
 * # Les deux moitiés du correctif
 *
 * `assignVersionMarkers` remplace le rang par des repères qui sont des
 * PROPRIÉTÉS (voir son en-tête), et il suppose que la liste qu'on lui donne
 * est une seule unité. Ce composant est l'autre moitié : il BORNE l'unité, et
 * `VersionUnitBar` la NOMME.
 *
 * Borner, concrètement, c'est envoyer une portée. `season`/`episode` de la
 * release affichée déterminent laquelle sans aucune heuristique, parce que
 * c'est exactement le prédicat SQL de `scopeWhere` :
 *
 *   saison + épisode → `episode`    (`season IS NOT NULL AND episode IS NOT NULL`)
 *   saison seule     → `season`     (`season IS NOT NULL AND episode IS NULL`)
 *   ni l'un ni l'autre, sur une série → `integral`  (`season IS NULL`)
 *   ni l'un ni l'autre, ailleurs      → `all`  — un film n'a qu'une découpe
 *
 * La portée dérivée contient donc TOUJOURS la release affichée, ce qui garde
 * la ligne « Ici » dans le tableau. Mesuré : `…S01E09` en portée `episode`
 * avec `season=1&episode=9` rend les 4 versions de l'épisode 9 ; `Cats.Eye.S01`
 * en portée `season` avec `season=1` rend 1 release, et le tableau cesse de
 * mentir en ne comparant plus rien.
 *
 * # La géométrie
 *
 * Onze pistes à positions fixes, déclarées une seule fois : la résolution est
 * TOUJOURS au même `x`. C'est ce qui permet de descendre une colonne sans lire
 * un nom de fichier — et c'est aussi pourquoi un repère par ligne au plus,
 * dans une fente de largeur fixe. Deux repères sur une ligne décaleraient tout
 * ce qui suit.
 *
 * Le tri reste la taille décroissante : la colonne des tailles descend, ce qui
 * se compare d'un coup en chiffres tabulaires. Ce n'est plus un classement
 * puisque les repères ne se calculent plus dessus.
 */
import { formatSize } from '~/utils/format';
import type { GroupScope, ScopeSummary } from '~/utils/groupScopes';
import { releaseChips } from '~/utils/releaseChips';
import { safeHttpUrl } from '~/utils/safeUrl';
import {
  assignVersionMarkers,
  releaseGroup,
  releaseTags,
  type VersionMarker,
} from '~/utils/versionMarkers';
import type { EpisodeBucket, SeasonBucket } from './VersionUnitBar.vue';

/** Une release telle que `/api/torrents/group` la renvoie. */
export interface GroupRelease {
  id: string | null;
  infoHash: string;
  name: string;
  size: number;
  seeders: number;
  leechers: number;
  createdAt: string | null;
  remote: { detailUrl: string | null; peers: string[] } | null;
}

/** La charge utile d'une portée, dans la forme documentée par `group.get.ts`. */
interface ScopePayload {
  group: { scopes: ScopeSummary[]; defaultScope: GroupScope };
  scope: GroupScope;
  seasons: SeasonBucket[];
  openSeason: number | null;
  episodes: EpisodeBucket[];
  episodesTruncated: boolean;
  openEpisode: number | null;
  releases: GroupRelease[];
  releasesTruncated: boolean;
}

const props = withDefaults(
  defineProps<{
    /** `tmdb:tv/209867`, `igdb:…` — avec son préfixe, ce que le composable dérive. */
    groupKey: string | null | undefined;
    /** La release affichée, pour la marquer « ici » plutôt que de s'y renvoyer. */
    currentInfoHash: string;
    /** La position dans la série. C'est elle qui borne l'unité — voir l'en-tête. */
    season?: number | null;
    episode?: number | null;
    /**
     * Déjà chargées par l'appelant, et supposées être UNE unité. Fournies,
     * aucune requête n'est faite et la barre d'unité ne se rend pas : sans
     * réponse serveur il n'y a ni portée, ni saisons, ni rien à naviguer.
     */
    releases?: GroupRelease[] | null;
    /** Au-delà, la fiche renvoie vers la page de groupe. */
    limit?: number;
  }>(),
  { season: null, episode: null, releases: null, limit: 8 },
);

const { loggedIn } = useUserSession();
const { locale } = useI18n();

/* ── Borner l'unité ───────────────────────────────────────────────────────── */

/**
 * La découpe à laquelle la release affichée appartient.
 *
 * Le test `tmdb:tv/` n'est pas une devinette : la clé de groupe est construite
 * en SQL comme `'tmdb:' || tmdb_id` et le découpage par saison teste
 * `tmdb_id LIKE 'tv/%'`, donc le préfixe porte la même information des deux
 * côtés. Compté sur le catalogue : 40 torrents en `tv/…`, 5 en identifiant nu
 * (des films), ZÉRO en `movie/…`, et — le seul chiffre qui compte ici — zéro
 * torrent portant une saison sans le préfixe `tv/`. Une série est donc toujours
 * reconnue, et un identifiant nu est un film.
 *
 * Tout ce qui n'est pas une série n'a qu'une découpe, que l'API nomme `all`.
 */
const homeScope = computed<GroupScope>(() => {
  if (props.season !== null && props.episode !== null) return 'episode';
  if (props.season !== null) return 'season';
  return props.groupKey?.startsWith('tmdb:tv/') ? 'integral' : 'all';
});

/** Ce qui est demandé au serveur. La réponse dit ce qui a été ouvert. */
const wanted = ref<{
  scope: GroupScope;
  season: number | null;
  episode: number | null;
}>({
  scope: homeScope.value,
  season: props.season,
  episode: props.episode,
});

// Changer de fiche sans démonter le composant remet l'unité de la nouvelle
// release : `<NuxtLink>` entre deux torrents réutilise la page.
watch(homeScope, (scope) => {
  wanted.value = { scope, season: props.season, episode: props.episode };
});

function pick(next: {
  scope: GroupScope;
  season: number | null;
  episode: number | null;
}) {
  wanted.value = next;
}

/* ── La requête, qui ne bloque pas le rendu ───────────────────────────────── */

/**
 * `lazy` et conditionnelle. La route exige une session : la lancer pour un
 * visiteur anonyme renverrait un 401 et rendrait une section en erreur là où
 * il n'y a rien à dire. Et `immediate: false` sans clé de groupe — une release
 * sans identifiant externe n'a pas d'œuvre à laquelle se rattacher.
 */
const shouldFetch = computed(
  () => !props.releases && !!props.groupKey && loggedIn.value,
);

/*
 * Sans `await`. `await useFetch()` au niveau du `setup` rend la composante
 * asynchrone et fait attendre le rendu de la page qui la contient — l'erreur
 * que le composable de la fiche a justement corrigée. `lazy` veut dire « la
 * section se rend vide puis se remplit », ce qui n'a de sens que si personne
 * n'attend.
 *
 * La `query` est réactive, donc changer d'unité recharge tout seul : c'est le
 * `watch` que `useAsyncData` installe sur les sources réactives de la clé, et
 * il tourne même sous `immediate: false`.
 */
const { data, pending } = useFetch<ScopePayload>('/api/torrents/group', {
  query: computed(() => ({
    key: props.groupKey ?? '',
    scope: wanted.value.scope,
    ...(wanted.value.season !== null ? { season: wanted.value.season } : {}),
    ...(wanted.value.episode !== null ? { episode: wanted.value.episode } : {}),
  })),
  lazy: true,
  immediate: shouldFetch.value,
});

/*
 * L'unité OUVERTE se lit dans la réponse, jamais dans `wanted`.
 *
 * Sans `season`, le serveur ouvre le seau le plus récent et le dit dans
 * `openSeason` ; recopier ce choix dans `wanted` changerait la clé de requête
 * et déclencherait un deuxième aller-retour pour la même réponse. Les deux
 * états sont donc distincts : `wanted` est la demande, la réponse est la
 * vérité, et la barre d'unité surligne la seconde.
 */
const payload = computed(() => data.value ?? null);
const scope = computed<GroupScope>(() => payload.value?.scope ?? wanted.value.scope);
const scopes = computed<ScopeSummary[]>(() => payload.value?.group?.scopes ?? []);
const openSeason = computed(() => payload.value?.openSeason ?? null);
const openEpisode = computed(() => payload.value?.openEpisode ?? null);

/* ── Les repères ──────────────────────────────────────────────────────────── */

interface VersionRow {
  key: string;
  name: string;
  size: number;
  seeders: number;
  marker: VersionMarker | null;
  current: boolean;
  /** Route interne, ou `null` pour une release que seul un partenaire détient. */
  to: string | null;
  /** L'URL du partenaire, déjà filtrée. */
  href: string | null;
  cells: {
    language: string | null;
    resolution: string | null;
    source: string | null;
    codec: string | null;
    group: string | null;
  };
}

const unit = computed<GroupRelease[]>(
  () => props.releases ?? payload.value?.releases ?? [],
);

/**
 * Une seule unité ?
 *
 * `all` est la seule portée qui mélange : sur une série elle rend S01, S02 et
 * l'intégrale ensemble, ce qui EST la panne de Cats.Eye. Elle n'est une unité
 * que lorsque l'œuvre n'a AUCUNE autre découpe — un film, un jeu, un livre,
 * dont `group.scopes` vaut exactement `[{ scope: 'all' }]`.
 *
 * « Une seule entrée dans `scopes` » serait le mauvais test, et c'est mesuré :
 * `tmdb:tv/34114` (Cats.Eye) répond `scopes: [{ season: 2 }]` — une entrée,
 * deux saisons. En portée `all` il rend S01 et S02 ensemble, et le garde-fou
 * les aurait laissées se comparer.
 *
 * Les pastilles de portée ne proposent que `group.scopes`, donc `all` n'est pas
 * atteignable au clic sur une série ; le garde-fou tient pour la portée
 * INITIALE et pour un futur appelant qui rouvrirait le cas sans le voir.
 */
const bounded = computed(() => {
  if (props.releases) return true;
  if (scope.value !== 'all') return true;
  return scopes.value.every((s) => s.scope === 'all');
});

const rows = computed<VersionRow[]>(() => {
  const sorted = [...unit.value].sort((a, b) => b.size - a.size);
  /*
   * Les repères sur l'unité ENTIÈRE, puis la coupe à `limit`. `light` est un
   * extremum : le calculer sur les huit premières lignes désignerait la plus
   * petite des huit, pas la plus petite de l'unité. Un repère qui tombe hors
   * de la vue est honnête ; un repère faux ne l'est pas.
   */
  const markers = bounded.value
    ? assignVersionMarkers(
        sorted.map((r) => ({ size: r.size, tags: releaseTags(r.name) })),
      )
    : sorted.map(() => null);

  return sorted.slice(0, props.limit).map((r, i) => {
    const c = releaseChips(r.name);
    const url = r.id ? null : safeHttpUrl(r.remote?.detailUrl);
    return {
      key: r.infoHash || r.name,
      name: r.name,
      size: r.size,
      seeders: r.seeders,
      marker: markers[i] ?? null,
      current: r.infoHash.toLowerCase() === props.currentInfoHash.toLowerCase(),
      to: r.id ? `/torrents/${r.infoHash}` : null,
      href: url,
      cells: {
        language: c.language,
        resolution: c.resolution,
        source: c.source,
        codec: c.codec,
        group: releaseGroup(r.name),
      },
    };
  });
});

/**
 * Se rend dès qu'il y a quelque chose à arbitrer OU à naviguer.
 *
 * Le seuil n'est plus « deux releases » : borner l'unité fait tomber
 * `Cats.Eye.S01` à une seule version, et masquer la section priverait alors du
 * seul chemin vers la saison 2. Une ligne unique plus une barre qui offre
 * `Saison 02 · 1 release` est utile, et elle n'affirme rien —
 * `assignVersionMarkers` ne pose aucun repère sur une version seule.
 */
const navigable = computed(() => {
  if (scopes.value.length > 1) return true;
  const p = payload.value;
  return !!p && (p.seasons.length > 1 || p.episodes.length > 1);
});
const show = computed(() => rows.value.length > 1 || navigable.value);

const hasCurrent = computed(() => rows.value.some((r) => r.current));
const hidden = computed(() => Math.max(0, unit.value.length - rows.value.length));

/** Les repères présents ici : la légende n'explique que ce qui est affiché. */
const shownMarkers = computed(() => {
  const seen = new Set<VersionMarker>();
  for (const r of rows.value) if (r.marker) seen.add(r.marker);
  return [...seen];
});

const groupHref = computed(() =>
  props.groupKey ? `/torrents/group/${props.groupKey}` : null,
);

const nf = computed(() => new Intl.NumberFormat(locale.value));
</script>

<template>
  <section v-if="show" class="versions">
    <SectionHead
      :title="$t('torrents.detail.versions.title')"
      :count="rows.length || null"
      icon="ph:stack-bold"
    >
      <template #action>
        <NuxtLink v-if="groupHref" :to="groupHref" class="versions-all">
          {{ $t('torrents.detail.versions.allReleases') }}
          <Icon name="ph:arrow-right-bold" aria-hidden="true" />
        </NuxtLink>
      </template>
    </SectionHead>

    <!-- L'unité, écrite en clair AVANT le tableau : c'est elle qui dit sur quoi
         porte la comparaison, et son absence était la moitié de la panne. -->
    <TorrentDetailVersionUnitBar
      v-if="payload"
      class="versions-unit"
      :scope="scope"
      :scopes="scopes"
      :seasons="payload.seasons"
      :open-season="openSeason"
      :episodes="payload.episodes"
      :open-episode="openEpisode"
      :episodes-truncated="payload.episodesTruncated"
      :home-scope="homeScope"
      :home-season="season"
      :home-episode="episode"
      :pending="pending"
      @pick="pick"
    />

    <div class="versions-card">
      <!--
        L'en-tête de colonnes est un repère VISUEL : `aria-hidden`, parce que
        six jetons courts annoncés après huit intitulés sans association de
        cellule n'apportent rien à un lecteur d'écran, alors que le lien de
        chaque ligne porte déjà le nom complet de la release.
      -->
      <div class="ver-row ver-row--head" aria-hidden="true">
        <span class="ver-mk" />
        <span class="ver-badge ver-badge--empty" />
        <span class="ver-c ver-lang">{{ $t('torrents.detail.versions.col.language') }}</span>
        <span class="ver-c ver-res">{{ $t('torrents.detail.versions.col.resolution') }}</span>
        <span class="ver-c ver-src">{{ $t('torrents.detail.versions.col.source') }}</span>
        <span class="ver-c ver-cod">{{ $t('torrents.detail.versions.col.codec') }}</span>
        <span class="ver-c ver-grp">{{ $t('torrents.detail.versions.col.group') }}</span>
        <span class="ver-name">{{ $t('torrents.detail.versions.col.name') }}</span>
        <span class="ver-size">{{ $t('torrents.detail.versions.col.size') }}</span>
        <span class="ver-seed">{{ $t('torrents.detail.versions.col.seeders') }}</span>
        <span class="ver-act" />
      </div>

      <div
        v-for="row in rows"
        :key="row.key"
        class="ver-row"
        :data-current="row.current ? 'true' : 'false'"
      >
        <span class="ver-mk" aria-hidden="true" />

        <!-- Un repère par ligne au plus, dans une fente de largeur fixe : deux
             repères décaleraient toutes les colonnes suivantes. -->
        <span
          v-if="row.marker"
          class="ver-badge"
          :data-marker="row.marker"
          :title="$t(`torrents.detail.versions.marker.${row.marker}Hint`)"
        >
          {{ $t(`torrents.detail.versions.marker.${row.marker}`) }}
        </span>
        <span v-else class="ver-badge ver-badge--empty" aria-hidden="true" />

        <span class="ver-c ver-lang">{{ row.cells.language ?? '—' }}</span>
        <span class="ver-c ver-res">{{ row.cells.resolution ?? '—' }}</span>
        <span class="ver-c ver-src">{{ row.cells.source ?? '—' }}</span>
        <span class="ver-c ver-cod">{{ row.cells.codec ?? '—' }}</span>
        <span class="ver-c ver-grp" :title="row.cells.group ?? undefined">{{
          row.cells.group ?? '—'
        }}</span>

        <span class="ver-name" :title="row.name">{{ row.name }}</span>

        <span class="ver-size">{{ formatSize(row.size) }}</span>

        <span class="ver-seed">
          {{ nf.format(row.seeders) }}
          <span class="ver-seed-u">{{ $t('torrents.detail.seedUnit') }}</span>
        </span>

        <span class="ver-act">
          <!-- La release affichée ne se renvoie pas à elle-même : elle dit
               qu'on y est. C'est le référent de la puce, expliqué en légende. -->
          <span v-if="row.current" class="ver-here">
            {{ $t('torrents.detail.versions.here') }}
          </span>
          <NuxtLink
            v-else-if="row.to"
            :to="row.to"
            class="tool-btn tool-btn--sm tool-btn--text ver-go"
            :aria-label="$t('torrents.detail.versions.viewAria', { name: row.name })"
          >
            <span class="ver-go-txt">{{ $t('torrents.detail.versions.view') }}</span>
            <Icon name="ph:arrow-right-bold" aria-hidden="true" />
          </NuxtLink>
          <!-- Chez un partenaire seulement : lien externe, jamais une route
               locale qui rendrait un 404. -->
          <a
            v-else-if="row.href"
            :href="row.href"
            target="_blank"
            rel="noopener noreferrer"
            class="tool-btn tool-btn--sm tool-btn--text ver-go"
            :aria-label="$t('torrents.detail.versions.viewPartnerAria', { name: row.name })"
          >
            <span class="ver-go-txt">{{ $t('torrents.detail.versions.viewPartner') }}</span>
            <Icon name="ph:arrow-square-out" aria-hidden="true" />
          </a>
          <span v-else class="ver-none" aria-hidden="true">—</span>
        </span>
      </div>

      <!-- La légende n'explique que les repères RÉELLEMENT posés : « Compat »
           décrit dans une unité qui n'en a aucun est du bruit. -->
      <div class="ver-legend">
        <span v-if="hasCurrent" class="ver-legend-item">
          <span class="ver-legend-dot" aria-hidden="true" />
          {{ $t('torrents.detail.versions.legend.current') }}
        </span>
        <span v-for="m in shownMarkers" :key="m" class="ver-legend-item">
          <b class="ver-legend-tag">{{ $t(`torrents.detail.versions.marker.${m}`) }}</b>
          {{ $t(`torrents.detail.versions.marker.${m}Hint`) }}
        </span>
        <span class="ver-legend-item">{{ $t('torrents.detail.versions.legend.unit') }}</span>
        <span v-if="payload?.releasesTruncated" class="ver-legend-item">
          {{ $t('search.group.truncated') }}
        </span>
        <NuxtLink v-if="hidden && groupHref" :to="groupHref" class="ver-legend-more">
          {{ $t('torrents.detail.versions.legend.more', { n: hidden }) }}
        </NuxtLink>
      </div>
    </div>
  </section>
</template>

<style scoped>
.versions-all {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
  text-decoration: none;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  transition: color var(--dur-2) ease;
}
.versions-all:hover { color: rgb(var(--accent)); }

.versions-unit { margin-bottom: 0.5rem; }

.versions-card {
  display: flex;
  flex-direction: column;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  overflow: hidden;
}

/*
 * Les positions fixes. Chaque piste est déclarée une fois, donc le `x` d'une
 * colonne est le même sur toutes les lignes au dixième de pixel près — c'est
 * une grille, pas un flex qui recalcule ligne par ligne. L'en-tête de colonnes
 * réutilise EXACTEMENT la même règle : deux déclarations dériveraient.
 */
.ver-row {
  display: grid;
  align-items: center;
  gap: 0.15rem 0.5rem;
  grid-template-columns:
    0.75rem 5rem
    3.4rem 3.2rem 4.4rem 3.4rem 5rem
    minmax(0, 1fr) 5.4rem 4.2rem 4.6rem;
  grid-template-areas: 'mk badge lang res src cod grp name size seed act';
  min-height: 2.5rem;
  padding: 0.3rem 0.85rem;
  transition: background-color var(--dur-1) var(--ease-standard);
}
.ver-row + .ver-row { border-top: 1px solid rgb(var(--line-default)); }
.ver-row:hover { background-color: rgb(var(--bg-hover)); }
.ver-row[data-current='true'] { background-color: rgb(var(--accent-warm) / 0.07); }

/* L'en-tête nomme les colonnes sans se faire passer pour une ligne : pas de
   survol, une hauteur réduite, et le fond en creux du conteneur. */
.ver-row--head {
  min-height: 1.9rem;
  background-color: rgb(var(--bg-inset));
  border-bottom: 1px solid rgb(var(--line-strong));
}
.ver-row--head:hover { background-color: rgb(var(--bg-inset)); }
.ver-row--head .ver-c,
.ver-row--head .ver-name,
.ver-row--head .ver-size,
.ver-row--head .ver-seed {
  font-family: var(--font-mono);
  font-size: 0.5625rem;
  font-weight: 600;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}

.ver-mk {
  grid-area: mk;
  justify-self: center;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-field));
}
.ver-row--head .ver-mk { border-color: transparent; }
.ver-row[data-current='true'] .ver-mk {
  background-color: rgb(var(--accent-warm));
  border-color: rgb(var(--accent-warm));
}

/*
 * Le repère. UNE seule apparence pour les quatre.
 *
 * Quatre teintes, ou une pleine pour « Image max » et trois discrètes pour le
 * reste, se reliraient comme quatre niveaux — c'est-à-dire comme le classement
 * que ce fichier existe pour supprimer. Les quatre nomment des propriétés
 * différentes, aucune n'est meilleure, donc aucune n'est plus voyante.
 *
 * Contour plutôt que fond plein : le texte reste `--fg-default` sur le fond de
 * la carte, et la bordure `--accent-warm` est un élément NON textuel, qui
 * relève des 3:1 de WCAG 1.4.11 — mesuré à 3,05:1 au pire des deux thèmes. La
 * paire `--accent-warm-text` sur un voile de la même teinte, elle, tombe sous
 * les 4,5:1 d'un texte en thème clair, et c'est pourquoi elle n'est pas ici.
 */
.ver-badge {
  grid-area: badge;
  justify-self: start;
  display: inline-flex;
  align-items: center;
  height: 1.3rem;
  padding: 0 0.4rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  white-space: nowrap;
  border: 1px solid rgb(var(--accent-warm) / 0.55);
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-default));
  cursor: help;
}
.ver-badge--empty {
  border-color: transparent;
  cursor: auto;
}

.ver-c {
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-lang { grid-area: lang; font-weight: 700; color: rgb(var(--fg-default)); }
.ver-res { grid-area: res; font-weight: 600; color: rgb(var(--fg-default)); }
.ver-src { grid-area: src; }
.ver-cod { grid-area: cod; }
/* Le groupe de release est un nom propre : en monospace il se compare
   caractère par caractère, ce que la colonne sert à faire. */
.ver-grp {
  grid-area: grp;
  font-family: var(--font-mono);
  font-size: 0.65625rem;
}
.ver-row--head .ver-grp { font-size: 0.5625rem; }

.ver-name {
  grid-area: name;
  min-width: 0;
  font-family: var(--font-mono);
  font-size: 0.71875rem;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ver-row[data-current='true'] .ver-name { color: rgb(var(--fg-default)); }

/* Les deux colonnes que l'œil compare : chiffres tabulaires, alignées à
   droite. Sans `tabular-nums`, un « 1 » étroit décale la virgule d'une ligne à
   l'autre et la comparaison ne se fait plus d'un coup d'œil. */
.ver-size {
  grid-area: size;
  text-align: right;
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: rgb(var(--fg-default));
}
.ver-seed {
  grid-area: seed;
  text-align: right;
  font-size: 0.75rem;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: rgb(var(--fg-default));
}
.ver-seed-u {
  font-size: 0.625rem;
  font-weight: 600;
  color: rgb(var(--fg-muted));
}

.ver-act { grid-area: act; justify-self: end; }
.ver-go { font-size: 0.6875rem; text-decoration: none; }
.ver-here {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2rem;
  padding: 0 0.5rem;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--accent-warm-text));
}
.ver-none { color: rgb(var(--fg-muted)); }

.ver-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem 0.9rem;
  padding: 0.35rem 0.85rem;
  border-top: 1px solid rgb(var(--line-default));
  font-size: 0.65625rem;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
}
.ver-legend-item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.ver-legend-tag {
  font-weight: 700;
  color: rgb(var(--fg-default));
  white-space: nowrap;
}
.ver-legend-dot {
  align-self: center;
  width: 0.5rem;
  height: 0.5rem;
  border-radius: var(--radius-pill);
  background-color: rgb(var(--accent-warm));
}
.ver-legend-more {
  color: rgb(var(--fg-default));
  font-weight: 600;
  text-decoration: none;
}
.ver-legend-more:hover { color: rgb(var(--accent)); }

/* ── Tablette : le codec et le nom partent, les colonnes restent alignées ─── */
@media (max-width: 1180px) {
  .ver-row {
    grid-template-columns:
      0.75rem 5rem
      3.4rem 3.2rem 4.4rem 5rem
      minmax(0, 1fr) 5.4rem 4.2rem 2.6rem;
    grid-template-areas: 'mk badge lang res src grp name size seed act';
  }
  .ver-cod { display: none; }
  .ver-go-txt { display: none; }
  .ver-go { width: 2rem; padding: 0; justify-content: center; }
}
@media (max-width: 960px) {
  /* Le nom part avant les jetons : langue + résolution + source + groupe
     identifient la release, le nom ne fait que les répéter en plus long. */
  .ver-row {
    grid-template-columns:
      0.75rem 5rem
      3.4rem 3.2rem 4.4rem minmax(0, 5rem)
      5.4rem 4.2rem 2.6rem;
    grid-template-areas: 'mk badge lang res src grp size seed act';
  }
  .ver-name { display: none; }
}

/* ── Mobile : la grille se casse en étages plutôt que de comprimer neuf
      colonnes dans 360 px ──────────────────────────────────────────────────── */
@media (max-width: 720px) {
  .ver-row {
    grid-template-columns: 0.75rem minmax(0, 1fr) auto 2.75rem;
    grid-template-areas:
      'mk name name act'
      'mk badge size seed'
      'mk lang res src';
    gap: 0.25rem 0.5rem;
    padding: 0.55rem 0.85rem;
  }
  /* Un en-tête de colonnes n'a plus de sens quand la ligne fait trois étages :
     les intitulés ne surplomberaient plus rien. */
  .ver-row--head { display: none; }
  .ver-name {
    display: block;
    white-space: normal;
    overflow-wrap: anywhere;
    text-overflow: clip;
  }
  .ver-grp { display: none; }
  .ver-lang,
  .ver-res,
  .ver-src { justify-self: start; }
  .ver-size { text-align: left; }
  .ver-seed { text-align: left; }
  .ver-mk { align-self: start; margin-top: 0.45rem; }
  .ver-act { align-self: start; }
  .ver-go { width: 2.75rem; height: 2.75rem; }
  .ver-here { min-height: 2.75rem; }
}
</style>
