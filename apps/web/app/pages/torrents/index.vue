<template>
  <div class="search-shell">
    <!-- ── Hero ──────────────────────────────────────────────── -->
    <header class="search-hero">
      <div class="search-hero-row">
        <div class="search-heading">
          <h1 class="search-title">
            {{ $t('search.titleMain') }} <span class="search-title-faint">{{ $t('search.titleAccent') }}</span>
          </h1>
          <!-- Hors du h1 : un lecteur d'écran lisait « Recherche Torrents 9 releases ».
               `role="status"` : le compte s'annonce quand les filtres changent. -->
          <p class="search-count" role="status" aria-live="polite">{{ countLine }}</p>
        </div>
        <div class="search-hero-actions">
          <NuxtLink
            to="/torrents/upload"
            class="upload-cta"
            :aria-label="$t('torrents.upload')"
          >
            <Icon name="ph:upload-simple-bold" />
            <span>{{ $t('torrents.upload') }}</span>
          </NuxtLink>
          <div class="search-mode" role="tablist" :aria-label="$t('search.resultView')">
            <button
              v-for="opt in viewOptions"
              :key="opt.value"
              type="button"
              role="tab"
              :aria-selected="view === opt.value"
              class="search-mode-btn"
              :class="{ 'search-mode-btn--on': view === opt.value }"
              @click="view = opt.value"
            >
              <Icon :name="opt.icon" />
              <span>{{ opt.label }}</span>
            </button>
          </div>
        </div>
      </div>

      <SearchTokenSearch
          v-model="searchQuery"
          :tokens="tokens"
          :loading="isLoading"
          :recent="recentSearches"
          :recently-viewed="recentlyViewed"
          @pick-work="onPickWork"
          @pick-recent="onPickRecent"
          @update:tokens="onTokens"
          @search="handleSearch"
          @media-id-search="handleMediaIdSearch"
        />

      <!-- Active media-id chip + filters toggle row -->
      <div class="search-meta-row">
        <Transition name="hint">
          <span
            v-if="activeMediaId"
            class="media-id-chip"
            :class="`media-id-chip--${activeMediaId.source}`"
          >
            <span class="media-id-chip-tag">{{ activeMediaId.label }}</span>
            <code class="media-id-chip-id">{{ activeMediaId.display }}</code>
            <button
              type="button"
              class="media-id-chip-close"
              :aria-label="$t('search.clearMediaIdFilter', { label: activeMediaId.label })"
              @click="clearMediaIdFilter"
            >
              <Icon name="ph:x-bold" class="text-[10px]" />
            </button>
          </span>
        </Transition>

      </div>
    </header>


    <!-- ── Categories (root row) ─────────────────────────────── -->

    <!-- ── Filters panel ─────────────────────────────────────── -->

    <!-- ── Rail de facettes + résultats ─────────────────────────
         Sur écran large le rail est toujours là, collant ; en dessous de 1100px
         il se replie derrière le bouton « Afficher les filtres » de l'en-tête,
         en attendant la feuille du téléphone. -->
    <div class="layout">
    <div v-if="filtersOpen" class="sheet-backdrop" @click="filtersOpen = false" />
    <aside
      id="search-filter-panel"
      ref="railEl"
      class="rail"
      :class="{ 'rail--open': filtersOpen }"
      :role="isNarrow && filtersOpen ? 'dialog' : undefined"
      :aria-modal="isNarrow && filtersOpen ? 'true' : undefined"
      :aria-label="$t('search.facets.title')"
      @keydown.esc="filtersOpen = false"
    >
      <div class="sheet-head">
        <h2 class="sheet-title rail-title" tabindex="-1">{{ $t('search.sheet.title') }}</h2>
        <button v-if="hasActiveQuery" type="button" class="sheet-clear" @click="clearAllFilters">
          {{ $t('search.filters.clearAll') }}
        </button>
        <button type="button" class="sheet-close" :aria-label="$t('search.sheet.close')" @click="filtersOpen = false">
          <Icon name="ph:x-bold" aria-hidden="true" />
        </button>
      </div>
      <!-- Sur écran étroit, le tri et la densité vivent dans la feuille : la
           barre collante ne garde que les puces. -->
      <div class="sheet-tools">
        <label class="rbar-sort">
          <span class="rbar-sort-k">{{ $t('search.sort.label') }}</span>
          <select class="rbar-select" :value="effectiveSort" @change="setSort(($event.target as HTMLSelectElement).value)">
            <option v-for="k in sortOptions" :key="k" :value="k">{{ $t(`search.sort.${k}`) }}</option>
          </select>
        </label>
        <button type="button" class="rbar-ico" :aria-label="$t('search.sort.toggle')" @click="toggleOrder">
          <Icon :name="sortOrder === 'asc' ? 'ph:sort-ascending-bold' : 'ph:sort-descending-bold'" aria-hidden="true" />
        </button>
        <div class="rbar-density" role="group" :aria-label="$t('search.density.label')">
          <button type="button" :class="{ 'is-on': !dense }" :aria-pressed="!dense" :title="$t('search.density.comfortable')" @click="density = 'comfortable'">
            <Icon name="ph:rows-bold" aria-hidden="true" />
            <span class="sr-only">{{ $t('search.density.comfortable') }}</span>
          </button>
          <button type="button" :class="{ 'is-on': dense }" :aria-pressed="dense" :title="$t('search.density.compact')" @click="density = 'compact'">
            <Icon name="ph:list-dashes-bold" aria-hidden="true" />
            <span class="sr-only">{{ $t('search.density.compact') }}</span>
          </button>
        </div>
      </div>
      <!-- Les alertes en tête du rail : une section comme les autres, et le
           rail a une raison d'être avant même le premier filtre. -->
      <SearchAlertsStrip
        rail
        :can-save="hasActiveQuery && canSaveSearch"
        :saving="savingSearch"
        :version="alertsVersion"
        @save="saveFromStrip"
      />
      <SearchCatalogueFacets
        :facets="facets ?? null"
        :loading="facetsPending"
        :categories="categories ?? []"
        :selected-category="selectedCategory"
        :tokens="tokens"
        :visible="catalogue.facets"
        :options="options"
        @select-category="handleCategorySelect"
        @toggle-slug="onFacetSlug"
        @toggle-year="onFacetYear"
        @toggle-option="toggleOption"
        :stats-at="facets?.statsAt ?? null"
      />
      <button type="button" class="sheet-apply" @click="filtersOpen = false">
        {{ $t('search.sheet.apply', pagination.total) }}
      </button>
    </aside>
    <section class="results" :aria-label="$t('search.results')">
    <!-- ── Filtres actifs, tri, densité ──────────────────────────
         Une barre collante : ce qui filtre la liste reste sous les yeux
         pendant qu'on la parcourt, et chaque puce s'enlève d'un clic. Le tri
         est un menu nommé plutôt qu'un en-tête de colonne cliquable, parce que
         les lignes n'ont plus d'en-têtes sur mobile. -->
    <div ref="rbarSentinel" class="rbar-sentinel" aria-hidden="true" />
    <div class="rbar" :class="{ 'rbar--stuck': rbarStuck }" role="region" :aria-label="$t('search.filters.title')">
      <div class="rbar-chips">
        <button
          v-if="selectedCategory"
          type="button"
          class="rbar-chip"
          :aria-label="$t('search.tokens.remove', { label: $t('search.filters.category'), value: selectedCategoryName })"
          @click="clearCategory"
        >
          <span class="rbar-chip-k">{{ $t('search.filters.category') }}</span>{{ selectedCategoryName }}
          <Icon name="ph:x-bold" aria-hidden="true" />
        </button>
        <button
          v-for="slug in selectedTags"
          :key="`tag-${slug}`"
          type="button"
          class="rbar-chip"
          :aria-label="$t('search.tokens.remove', { label: $t('search.filters.tag'), value: slug })"
          @click="toggleTag(slug)"
        >
          <span class="rbar-chip-k">{{ $t('search.filters.tag') }}</span>{{ slug }}
          <Icon name="ph:x-bold" aria-hidden="true" />
        </button>
        <button
          v-for="(tk, i) in tokens"
          :key="`tk-${tk.kind}-${tk.value}`"
          type="button"
          class="rbar-chip rbar-chip--token"
          :aria-label="$t('search.tokens.remove', { label: tokenKindLabel(tk.kind), value: tokenLabel(tk) })"
          @click="removeToken(i)"
        >
          <span class="rbar-chip-k">{{ tokenKindLabel(tk.kind) }}</span>{{ tokenLabel(tk) }}
          <Icon name="ph:x-bold" aria-hidden="true" />
        </button>
        <button
          v-for="opt in options"
          :key="`opt-${opt}`"
          type="button"
          class="rbar-chip rbar-chip--opt"
          :aria-label="$t('search.tokens.remove', { label: $t('search.options.chip'), value: $t(`search.options.${opt}`) })"
          @click="toggleOption(opt)"
        >
          <span class="rbar-chip-k">{{ $t('search.options.chip') }}</span>{{ $t(`search.options.${opt}`) }}
          <Icon name="ph:x-bold" aria-hidden="true" />
        </button>
        <button v-if="hasActiveQuery" type="button" class="rbar-clear" @click="clearAllFilters">
          {{ $t('search.filters.clearAll') }}
        </button>
        <button
          v-if="hasActiveQuery && !defaultsMatch"
          type="button"
          class="rbar-clear rbar-defaults"
          :disabled="savingDefaults"
          :title="$t('search.defaults.hint')"
          @click="saveDefaults"
        >
          <Icon name="ph:push-pin-simple-bold" aria-hidden="true" />
          {{ $t('search.defaults.save') }}
        </button>
        <button
          v-else-if="defaultsMatch"
          type="button"
          class="rbar-clear rbar-defaults rbar-defaults--on"
          :disabled="savingDefaults"
          :title="$t('search.defaults.clear')"
          @click="clearDefaults"
        >
          <Icon name="ph:push-pin-simple-fill" aria-hidden="true" />
          {{ $t('search.defaults.active') }}
        </button>
        <!-- Sans filtre, la barre dit ce qu'elle montre : le compte, et la taille en vue Releases. -->
        <span v-else-if="shownTotal > 0" class="rbar-sum">
          <strong>{{ shownTotal }}</strong>
          {{ view === 'grouped' ? $t('search.group.workCount', shownTotal) : $t('search.torrentCount', shownTotal) }}
          <template v-if="totalSize > 0"> · {{ formatSize(totalSize) }}</template>
        </span>
        <span v-else class="rbar-none">{{ $t('search.filters.none') }}</span>
      </div>
      <div class="rbar-tools">
        <!-- Seulement sur une instance qui a des partenaires : sur une instance
             seule, les deux options donneraient la même liste. -->
        <div
          v-if="view === 'grouped' && (federated || sources === 'local')"
          class="src-toggle"
          :title="$t('search.group.sourcesHint')"
        >
          <button type="button" :class="{ 'src-on': sources === 'all' }" @click="sources = 'all'">
            <Icon name="ph:broadcast-bold" />
            {{ $t('search.group.sourcesAll') }}
          </button>
          <button type="button" :class="{ 'src-on': sources === 'local' }" @click="sources = 'local'">
            <Icon name="ph:house-bold" />
            {{ $t('search.group.sourcesLocal') }}
          </button>
        </div>
        <label class="rbar-sort">
          <span class="rbar-sort-k">{{ $t('search.sort.label') }}</span>
          <select
            class="rbar-select"
            :value="effectiveSort"
            @change="setSort(($event.target as HTMLSelectElement).value)"
          >
            <option v-for="k in sortOptions" :key="k" :value="k">{{ $t(`search.sort.${k}`) }}</option>
          </select>
        </label>
        <button
          type="button"
          class="rbar-ico"
          :aria-label="$t('search.sort.toggle')"
          :title="sortOrder === 'asc' ? $t('search.sort.asc') : $t('search.sort.desc')"
          @click="toggleOrder"
        >
          <Icon :name="sortOrder === 'asc' ? 'ph:sort-ascending-bold' : 'ph:sort-descending-bold'" aria-hidden="true" />
        </button>
        <div class="rbar-density" role="group" :aria-label="$t('search.density.label')">
          <button
            type="button"
            :class="{ 'is-on': !dense }"
            :aria-pressed="!dense"
            :title="$t('search.density.comfortable')"
            @click="density = 'comfortable'"
          >
            <Icon name="ph:rows-bold" aria-hidden="true" />
            <span class="sr-only">{{ $t('search.density.comfortable') }}</span>
          </button>
          <button
            type="button"
            :class="{ 'is-on': dense }"
            :aria-pressed="dense"
            :title="$t('search.density.compact')"
            @click="density = 'compact'"
          >
            <Icon name="ph:list-dashes-bold" aria-hidden="true" />
            <span class="sr-only">{{ $t('search.density.compact') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- ── Pinned ────────────────────────────────────────────────
         Above the results and visually apart, because a pin answers a
         different question than the listing does: not "what matches" but
         "read this one". Rendered with the same table so the columns line up
         with the flow underneath — a pin changes the position of a release,
         never how it is read. -->

    <!-- Vue Releases seulement : les épinglés arrivent avec la liste plate, que la
         vue Œuvres ne recharge pas. Sans cette garde, ils restaient affichés après
         un aller-retour Releases → Œuvres. -->
    <SearchPinnedCards v-if="view === 'simple' && pinnedTorrents.length > 0" :torrents="pinnedTorrents" />

    <!-- ── Results body ──────────────────────────────────────── -->
    <section :class="{ 'is-refreshing': isLoading && resultCount > 0 }" :aria-busy="isLoading">
      <div v-if="isLoading && resultCount === 0 && pagination.total === 0" class="results-loading" role="status">
        <span class="sr-only">{{ $t('search.searchingDatabase') }}</span>
        <div v-for="n in 4" :key="n" class="skel" :style="{ '--i': n - 1 }" aria-hidden="true">
          <span class="skel-pst" /><span class="skel-l skel-l--t" /><span class="skel-l skel-l--m" />
        </div>
      </div>
      <!-- Quand rien ne sort : ce que donne la même recherche sans chacun de
           ses critères (les comptes viennent des facettes), puis demander la
           release ou poser une alerte. Une page vide n'est pas un cul-de-sac. -->
      <div v-else-if="resultCount === 0 && !isLoading" class="empty">
        <div class="empty-main">
          <h3 class="empty-title">{{ emptyTitle }}</h3>
          <p class="empty-hint">{{ $t('search.empty.hint') }}</p>
          <p v-if="facets?.didYouMean?.length" class="empty-dym">
            <span>{{ $t('search.empty.didYouMean') }}</span>
            <button
              v-for="w in facets.didYouMean"
              :key="`${w.source}:${w.externalId}`"
              type="button"
              class="empty-rel empty-rel--dym"
              @click="onPickWork({ key: `${w.source}:${w.externalId}`, source: w.source as SuggestedWork['source'], externalId: w.externalId, title: w.title, year: null, posterUrl: null, releaseCount: 0 })"
            >
              {{ w.title }}
            </button>
          </p>
          <ul v-if="emptySuggestions.length" class="empty-list">
            <li v-for="sug in emptySuggestions" :key="sug.key">
              <button type="button" class="empty-rel" @click="sug.apply">
                <span>{{ sug.label }}</span>
                <b>{{ sug.count }}</b>
              </button>
            </li>
          </ul>
        </div>
        <div class="empty-act">
          <NuxtLink to="/requests/new" class="empty-btn empty-btn--primary">
            <Icon name="ph:hand-palm-bold" aria-hidden="true" />
            {{ $t('search.empty.request') }}
          </NuxtLink>
          <button
            v-if="canSaveSearch"
            type="button"
            class="empty-btn empty-btn--gold"
            :disabled="savingSearch"
            @click="saveFromStrip"
          >
            <Icon name="ph:bell-bold" aria-hidden="true" />
            {{ $t('search.empty.alert') }}
          </button>
        </div>
      </div>
      <template v-else>
        <!-- Simple: classic table -->
        <div v-if="view === 'simple'" class="card overflow-hidden">
          <div class="overflow-x-auto">
            <SearchReleaseRows :torrents="torrents" :dense="dense" group-versions />
          </div>
        </div>
        <!-- Grouped: one row per work, collapsed.

             The row states what the work is and HOW IT HAS BEEN CUT — per
             episode, as season packs, as an integral — and each of those is a
             way in as well as a label. Opening a row is for choosing a file;
             finding out what exists happens without opening anything. -->
        <!-- Aucun panneau autour : `.card` peint `--bg-surface`, exactement la
             couleur des cartes, si bien que les 8px d'écart se lisaient comme
             une séparation INTERNE à un seul bloc. Ici chaque carte EST l'objet ;
             le fond de la page doit passer entre elles. -->
        <SearchWorkCards
          v-else
          :groups="servedGroups"
          :category-label="categoryLabel"
          :dense="dense"
          :filter-query="committedFilterQuery"
          :sort-by="effectiveSort"
          :order="sortOrder"
        />
      </template>

      <!-- Bottom pagination -->
      <div v-if="pagination.pages > 1 && resultCount > 0" class="results-foot">
        <button
          v-if="page + loadedPages <= pagination.pages"
          type="button"
          class="tool-btn tool-btn--text"
          :disabled="loadingMore"
          @click="loadMore"
        >
          <Icon :name="loadingMore ? 'ph:circle-notch' : 'ph:plus-bold'" :class="{ 'animate-spin': loadingMore }" aria-hidden="true" />
          {{ $t('search.loadMore', { n: Math.max(1, Math.min(catalogue.pageSize, pagination.total - resultCount)) }) }}
        </button>
        <p class="results-foot-summary">
          {{ $t('search.page') }} <strong>{{ pagination.page }}</strong> /
          {{ pagination.pages }}
          <span v-if="pagination.total > 0">
            · <strong>{{ pagination.total }}</strong> {{ $t('search.total') }}
          </span>
        </p>
        <Pager
          :page="pagination.page"
          :pages="pagination.pages"
          @go="goToPage"
        />
      </div>
    </section>

    <!-- ── Trending (when nothing's queried) ─────────────────── -->
    </section>
    </div>
  </div>

    <!-- Sur écran étroit, le rail est une feuille : ce bouton l'ouvre et porte
         le nombre de filtres posés. -->
    <button
      type="button"
      ref="fabEl"
      class="m-fab"
      :aria-expanded="filtersOpen"
      aria-controls="search-filter-panel"
      @click="filtersOpen = !filtersOpen"
    >
      <Icon name="ph:funnel-bold" aria-hidden="true" />
      {{ $t('search.sheet.open') }}
      <span v-if="hasActiveQuery" class="m-fab-n">{{ pagination.total }}</span>
    </button>
</template>

<script setup lang="ts">
import { formatSize, formatAge } from '~/utils/format';
import { tokensFromQuery, tokensToQuery, tokensToUrl, tokenSlugs, tokenLabel, toggleSlug, type SearchToken, type TagKind } from '~/utils/searchTokens';
import { OPTION_KEYS, type FacetsResponse, type OptionKey } from '~/utils/catalogueFacets';
import type { RecentSearch, SuggestedWork } from '~/components/search/TokenSearch.vue';
import { TORRENT_SORT_KEYS } from '@trackarr/shared';
import type { TorrentSortKey, SortDirection } from '@trackarr/shared';
import Pager from '~/components/search/Pager.vue';

interface TorrentTag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface TorrentWithStats {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  /**
   * Timestamp the torrent was last actioned by a moderator (approved,
   * rejected, changes-requested). Equal to `createdAt` for the auto-
   * approved path — the upload handler sets both to `now` in that
   * case. Null only for rows still sitting in `pending`. We use it as
   * the effective sort key so a torrent that spent a week in the
   * queue doesn't surface as week-old in the listing.
   */
  moderatedAt: string | null;
  // External-database ids — the grouped view buckets by tmdbId for
  // movies/series, igdbId for games and openlibraryId for books so
  // siblings cluster into one card with a poster. The other ids are
  // kept for the chips in the row body.
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  igdbId: string | null;
  openlibraryId: string | null;
  category?: {
    id: string;
    name: string;
    slug: string;
    type: 'movie' | 'tv' | 'game' | 'book' | null;
  };
  tags?: TorrentTag[];
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

import type { GroupScope } from '~/utils/groupScopes';

interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  subcategories?: Category[];
}

const route = useRoute();
const router = useRouter();
const { t } = useI18n();

/** Un paramètre répété (`?q=a&q=b`) arrive en tableau : on prend le premier, jamais le tableau. */
const str = (v: unknown): string => (Array.isArray(v) ? String(v[0] ?? '') : typeof v === 'string' ? v : '');
const searchQuery = ref(str(route.query.q));
const selectedCategory = ref(str(route.query.c));
const selectedTags = ref<string[]>(
  str(route.query.tag)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const filtersOpen = ref(selectedTags.value.length > 0);
/*
 * Les jetons de la barre (résolution, codec, saison, année, @uploadeur…) :
 * relus depuis l'URL au chargement, réécrits dedans à chaque changement, pour
 * qu'une recherche se partage et se retrouve au retour arrière.
 */
const tokens = ref<SearchToken[]>(tokensFromQuery(route.query as Record<string, unknown>));
/*
 * La densité est un choix de lecture, pas de recherche : elle vit dans un
 * cookie plutôt que dans l'URL, et vaut pour toutes les listes du site.
 */
const density = useCookie<'comfortable' | 'compact'>('trackarr-catalogue-density', {
  default: () => 'comfortable',
  maxAge: 60 * 60 * 24 * 365,
  sameSite: 'lax',
  path: '/',
  httpOnly: false,
});
const dense = computed(() => density.value === 'compact');
/*
 * Les quatre options du rail — avec des sources, gratuit, pas encore pris,
 * masquer les remplacées — vivent dans l'URL sous `o=seeded,free,…`, et se
 * traduisent en drapeaux pour l'API (`minSeeders`, `freeleech`, `notTaken`,
 * `hideSuperseded`).
 */
function optionsFromQuery(raw: unknown): OptionKey[] {
  const str = typeof raw === 'string' ? raw : '';
  return str.split(',').filter((k): k is OptionKey => (OPTION_KEYS as readonly string[]).includes(k));
}
function optionsToQuery(list: OptionKey[]) {
  return {
    minSeeders: list.includes('seeded') ? 1 : undefined,
    freeleech: list.includes('free') ? '1' : undefined,
    notTaken: list.includes('untaken') ? '1' : undefined,
    hideSuperseded: list.includes('current') ? '1' : undefined,
    favorites: list.includes('favorites') ? '1' : undefined,
    since: list.includes('today') ? '24h' : undefined,
  };
}
const options = ref<OptionKey[]>(optionsFromQuery(route.query.o));
function toggleOption(key: OptionKey) {
  options.value = options.value.includes(key)
    ? options.value.filter((k) => k !== key)
    : [...options.value, key];
  page.value = 1;
  updateUrl();
}
function onFacetSlug(kind: TagKind, slug: string) {
  onTokens(toggleSlug(tokens.value, kind, slug));
}
function onFacetYear(year: number) {
  const current = tokens.value.find((tk) => tk.kind === 'year');
  const rest = tokens.value.filter((tk) => tk.kind !== 'year');
  onTokens(current && Number(current.value) === year ? rest : [...rest, { kind: 'year', raw: String(year), value: String(year) }]);
}
/* ── Œuvres suggérées, recherches récentes ────────────────────────────────── */
/**
 * Choisir une œuvre dans les suggestions, c'est filtrer le catalogue sur elle :
 * son identifiant TMDb devient le filtre de la page, dans la vue en cours. Les
 * jeux et les livres n'ont pas de filtre d'identifiant ici — leur page de
 * groupe fait le même travail.
 */
function onPickWork(work: SuggestedWork) {
  if (work.source === 'tmdb') {
    searchQuery.value = '';
    mediaIdFilter.value = { source: 'tmdb', id: work.externalId };
    page.value = 1;
    updateUrl();
    return;
  }
  router.push(`/torrents/group/${work.key}`);
}
const RECENT_LS_KEY = 'trackarr.recentSearches';
const RECENT_MAX = 6;
const recentSearches = ref<RecentSearch[]>([]);
onMounted(() => {
  try {
    const raw = localStorage.getItem(RECENT_LS_KEY);
    const parsed = raw ? (JSON.parse(raw) as RecentSearch[]) : [];
    if (Array.isArray(parsed)) recentSearches.value = parsed.filter((r) => r && typeof r.label === 'string' && r.query).slice(0, RECENT_MAX);
  } catch {
    /* stockage indisponible : pas de récentes, rien de plus */
  }
});
/** Une recherche validée par Entrée entre dans les récentes ; la même étiquette ne s'y répète pas. */
function pushRecent() {
  const label = [searchQuery.value.trim(), ...tokens.value.map((tk) => tokenLabel(tk))].filter(Boolean).join(' ');
  if (!label) return;
  const query = Object.fromEntries(
    Object.entries(currentUrlQuery()).filter(([k, v]) => v !== undefined && k !== 'p'),
  ) as Record<string, string>;
  const next = [{ label, query }, ...recentSearches.value.filter((r) => r.label !== label)].slice(0, RECENT_MAX);
  recentSearches.value = next;
  try {
    localStorage.setItem(RECENT_LS_KEY, JSON.stringify(next));
  } catch {
    /* idem */
  }
}
function onPickRecent(query: Record<string, string>) {
  // Le champ garde le focus (le panneau intercepte le mousedown) : le gardien
  // de route, voyant « en train de taper », n'appliquerait pas `q`. On le pose ici.
  searchQuery.value = query.q ?? '';
  router.push({ path: '/torrents', query });
}

/* ── Les réglages du compte : « faire de ces filtres mon réglage » ─────────── */
/*
 * Le profil porte les filtres par défaut sous la forme de la chaîne de requête
 * de cette page. Chargés côté client seulement (la page ne dépend pas d'eux
 * pour se rendre) ; appliqués une fois, à l'arrivée sans aucun paramètre.
 */
const { data: me, refresh: refreshMe } = await useFetch<{ catalogueDefaults: Record<string, string> | null }>(
  '/api/me',
  { server: false, lazy: true },
);
const savedDefaults = computed(() => me.value?.catalogueDefaults ?? null);
const savingDefaults = ref(false);
let defaultsApplied = false;
watch(
  savedDefaults,
  (d) => {
    if (defaultsApplied || !d || Object.keys(d).length === 0) return;
    defaultsApplied = true;
    // « Sans paramètre » : la vue mémorisée (`v`) n'est pas un filtre, elle ne
    // compte pas ; on la garde telle quelle à côté des réglages.
    const others = Object.keys(route.query).filter((k) => k !== 'v');
    if (others.length === 0) {
      const v = typeof route.query.v === 'string' ? route.query.v : undefined;
      router.replace({ path: '/torrents', query: v ? { ...d, v } : d });
    }
  },
  { immediate: true },
);
const defaultsQuery = computed(() =>
  Object.fromEntries(Object.entries(currentUrlQuery()).filter(([k, v]) => v !== undefined && k !== 'p')) as Record<string, string>,
);
const defaultsMatch = computed(() => {
  const d = savedDefaults.value;
  if (!d) return false;
  const a = JSON.stringify(Object.entries(d).sort());
  const b = JSON.stringify(Object.entries(defaultsQuery.value).map(([k, v]) => [k, String(v)]).sort());
  return a === b;
});
async function saveDefaults() {
  savingDefaults.value = true;
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { catalogueDefaults: defaultsQuery.value } });
    await refreshMe();
    savedSearchNotifications.success(t('search.defaults.saved'));
  } catch {
    savedSearchNotifications.error(t('search.defaults.failed'));
  } finally {
    savingDefaults.value = false;
  }
}
async function clearDefaults() {
  savingDefaults.value = true;
  try {
    await $fetch('/api/me', { method: 'PATCH', body: { catalogueDefaults: null } });
    await refreshMe();
    savedSearchNotifications.success(t('search.defaults.cleared'));
  } catch {
    savedSearchNotifications.error(t('search.defaults.failed'));
  } finally {
    savingDefaults.value = false;
  }
}

/* ── Vu récemment : les fiches ouvertes, gardées par le navigateur ─────────── */
const recentlyViewed = ref<Array<{ hash: string; title: string }>>([]);
onMounted(() => {
  try {
    const raw = localStorage.getItem('trackarr.recentlyViewed');
    const parsed = raw ? (JSON.parse(raw) as Array<{ hash: string; title: string }>) : [];
    if (Array.isArray(parsed)) recentlyViewed.value = parsed.filter((r) => r && typeof r.hash === 'string' && typeof r.title === 'string').slice(0, 8);
  } catch {
    /* rien de plus */
  }
});

/* ── Le bandeau d'alertes : enregistrer d'ici, puis rafraîchir la liste ───── */
const alertsVersion = ref(0);
async function saveFromStrip() {
  await saveCurrentSearch();
  alertsVersion.value += 1;
}

/* ── La feuille de filtres sur écran étroit ───────────────────────────────── */
const railEl = ref<HTMLElement | null>(null);
/*
 * Une barre qui colle porte une ombre ; posée dans le flux, aucune. Un témoin
 * d'un pixel juste au-dessus dit lequel des deux : il sort de l'écran quand
 * la barre s'accroche.
 */
const rbarSentinel = ref<HTMLElement | null>(null);
const rbarStuck = ref(false);
let rbarObserver: IntersectionObserver | null = null;
onMounted(() => {
  if (!rbarSentinel.value || typeof IntersectionObserver === 'undefined') return;
  // La barre se colle sous l'en-tête du site, pas au bord de l'écran : le repère
  // compte comme sorti dès qu'il passe sous cet en-tête, sinon l'état « collé »
  // arrivait 64px trop tard.
  const bar = rbarSentinel.value.nextElementSibling;
  const stickTop = bar ? parseFloat(getComputedStyle(bar).top) || 0 : 0;
  rbarObserver = new IntersectionObserver(
    ([entry]) => {
      rbarStuck.value = !!entry && !entry.isIntersecting;
    },
    { rootMargin: `-${Math.ceil(stickTop)}px 0px 0px 0px` },
  );
  rbarObserver.observe(rbarSentinel.value);
});
onBeforeUnmount(() => rbarObserver?.disconnect());
// Sur écran étroit, le bouton flottant recouvre ce qui touche le bas de la
// fenêtre : la page marque le corps pour que le pied de page se dégage.
useHead({ bodyAttrs: { class: 'has-fab' } });
const isNarrow = ref(false);
let narrowQuery: MediaQueryList | null = null;
const onNarrowChange = (e: MediaQueryListEvent | MediaQueryList) => {
  isNarrow.value = e.matches;
};
onMounted(() => {
  narrowQuery = window.matchMedia('(max-width: 68.75rem)');
  onNarrowChange(narrowQuery);
  narrowQuery.addEventListener('change', onNarrowChange);
});
onBeforeUnmount(() => {
  narrowQuery?.removeEventListener('change', onNarrowChange);
  if (import.meta.client) document.documentElement.style.overflow = '';
});
// Une feuille ouverte fige la page derrière elle et prend le focus ; fermée,
// elle rend les deux.
watch([filtersOpen, isNarrow], ([open, narrow], [wasOpen]) => {
  if (!import.meta.client) return;
  document.documentElement.style.overflow = open && narrow ? 'hidden' : '';
  if (open && narrow) nextTick(() => railEl.value?.querySelector<HTMLElement>('.sheet-title')?.focus());
  // Fermée, la feuille rend le focus au bouton qui l'a ouverte : au clavier, on
  // ne repart pas du haut de la page.
  else if (wasOpen && !open && narrow) nextTick(() => fabEl.value?.focus());
});
const fabEl = ref<HTMLElement | null>(null);

/* ── L'état vide qui propose ──────────────────────────────────────────────── */
const emptyTitle = computed(() => {
  const words = [
    searchQuery.value.trim(),
    ...tokens.value.map((tk) => tokenLabel(tk)),
    selectedCategoryName.value,
    ...selectedTags.value,
    ...options.value.map((o) => t(`search.options.${o}`)),
    activeMediaId.value ? `${activeMediaId.value.label} ${activeMediaId.value.display}` : '',
  ].filter(Boolean);
  return words.length ? t('search.empty.title', { q: words.join(' ') }) : t('search.empty.titleNoQuery');
});
interface EmptySuggestion {
  key: string;
  label: string;
  count: number;
  apply: () => void;
}
const OPTION_BY_PARAM: Record<string, OptionKey> = {
  minSeeders: 'seeded',
  freeleech: 'free',
  notTaken: 'untaken',
  hideSuperseded: 'current',
  favorites: 'favorites',
  since: 'today',
};
const emptySuggestions = computed<EmptySuggestion[]>(() => {
  const f = facets.value;
  if (!f?.dropOne) return [];
  const without = (what: string) => t('search.empty.without', { what });
  const tagTokens = tokens.value.filter((tk) => tk.slugs?.length);
  const out: EmptySuggestion[] = [];
  for (const d of f.dropOne) {
    const k = d.key;
    if (k === 'search') {
      out.push({ key: k, label: without(t('search.empty.text', { q: searchQuery.value.trim() })), count: d.count, apply: () => { searchQuery.value = ''; page.value = 1; updateUrl(); } });
    } else if (k === 'categoryId') {
      out.push({ key: k, label: without(selectedCategoryName.value), count: d.count, apply: clearCategory });
    } else if (k === 'tag') {
      out.push({ key: k, label: without(selectedTags.value.join(', ')), count: d.count, apply: () => { selectedTags.value = []; page.value = 1; updateUrl(); } });
    } else if (k.startsWith('tagGroups:')) {
      const tk = tagTokens[Number(k.slice('tagGroups:'.length))];
      if (!tk) continue;
      const idx = tokens.value.indexOf(tk);
      out.push({ key: k, label: without(`${tokenKindLabel(tk.kind)} ${tokenLabel(tk)}`), count: d.count, apply: () => removeToken(idx) });
    } else if (k === 'year' || k === 'season' || k === 'episode' || k === 'uploader') {
      const idx = tokens.value.findIndex((tk) => tk.kind === k);
      if (idx < 0) continue;
      out.push({ key: k, label: without(tokenLabel(tokens.value[idx]!)), count: d.count, apply: () => removeToken(idx) });
    } else if (k in OPTION_BY_PARAM) {
      const opt = OPTION_BY_PARAM[k]!;
      out.push({ key: k, label: without(t(`search.options.${opt}`)), count: d.count, apply: () => toggleOption(opt) });
    } else if (k === 'imdbid' || k === 'tmdbid' || k === 'tvdbid') {
      out.push({ key: k, label: without(activeMediaId.value ? `${activeMediaId.value.label} ${activeMediaId.value.display}` : k), count: d.count, apply: clearMediaIdFilter });
    }
  }
  if (typeof f.catalogue === 'number' && f.catalogue > 0) {
    out.push({ key: 'all', label: t('search.empty.all'), count: f.catalogue, apply: clearAllFilters });
  }
  return out;
});

const activeFilterCount = computed(
  () =>
    (selectedCategory.value ? 1 : 0) +
    selectedTags.value.length +
    tokens.value.length +
    options.value.length +
    (mediaIdFilter.value ? 1 : 0),
);
const tokenKindLabel = (kind: SearchToken['kind']) => t(`search.tokens.${kind}`);
function clearCategory() {
  selectedCategory.value = '';
  page.value = 1;
  updateUrl();
}
/*
 * Une puce posée ou retirée dans la barre est un filtre appliqué : elle part
 * dans l'URL tout de suite, comme un clic sur une catégorie — le texte libre,
 * lui, n'y va qu'à Entrée, sinon chaque lettre ferait une entrée d'historique.
 */
function onTokens(next: SearchToken[]) {
  tokens.value = next;
  page.value = 1;
  updateUrl();
}
function removeToken(index: number) {
  tokens.value = tokens.value.filter((_, i) => i !== index);
  page.value = 1;
  updateUrl();
}
function clearAllFilters() {
  searchQuery.value = '';
  selectedCategory.value = '';
  selectedTags.value = [];
  tokens.value = [];
  options.value = [];
  mediaIdFilter.value = null;
  page.value = 1;
  updateUrl();
}
const SORT_KEYS = ['relevance', 'age', 'name', 'size', 'seeders', 'leechers', 'completed'] as const;
const isSortKey = (key: string): key is (typeof SORT_KEYS)[number] =>
  (SORT_KEYS as readonly string[]).includes(key);
function setSort(key: string) {
  if (!isSortKey(key)) return;
  sortBy.value = key;
  sortOrder.value = key === 'name' ? 'asc' : 'desc';
  page.value = 1;
  updateUrl();
}
function toggleOrder() {
  sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  page.value = 1;
  updateUrl();
}
const page = ref(Math.max(1, parseInt(str(route.query.p) || '1', 10) || 1));

/**
 * Sort, in the URL so a sorted listing can be linked, bookmarked and walked
 * back through with the browser's own history — the same contract the search,
 * category and tag filters already have.
 *
 * The server does the ordering: sorting a page of 20 client-side would order
 * twenty rows out of twelve thousand, which reads as a broken feature the
 * moment a member pages forward.
 */
/*
 * Le tri : `null` = automatique — pertinence dès qu'un texte est tapé, sinon le
 * défaut de l'instance ; une valeur = le choix explicite du membre, et lui seul
 * s'écrit dans l'URL.
 */
function sortKeyParam(v: unknown): TorrentSortKey | null {
  return typeof v === 'string' && ['relevance', 'age', 'name', 'size', 'seeders', 'leechers', 'completed'].includes(v)
    ? (v as TorrentSortKey)
    : null;
}
const sortBy = ref<TorrentSortKey | null>(sortKeyParam(route.query.s));
const sortOrder = ref<SortDirection>(
  (route.query.d as string) === 'asc' ? 'asc' : 'desc'
);

/**
 * Clicking the active column reverses it; clicking another switches to it.
 *
 * A fresh column starts descending, which is what every one of these means when
 * you first ask for it: newest, biggest, most seeded. `name` is the exception —
 * nobody wants Z-to-A first. (`category` used to be listed here too; it is not
 * a sortable column, so that half of the condition never ran.)
 */
function applySort(key: TorrentSortKey) {
  if (sortBy.value === key) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc';
  } else {
    sortBy.value = key;
    sortOrder.value = key === 'name' ? 'asc' : 'desc';
  }
  page.value = 1;
  updateUrl();
}
// View preference is persisted in localStorage so the user keeps the
// same mode across visits. Precedence:
//   1. `?v=…` in the URL — wins on every render so a shared link forces
//      the mode on the recipient.
//   2. `trackarr.torrents.view` in localStorage — read once on the client
//      so SSR doesn't try to access browser storage.
//   3. `simple` — default for first-time visitors.
//
// The localStorage key was renamed from `trackarr.search.view` when the
// /search page was merged into /torrents. Older clients with the old
// key just fall back to the default — no migration needed since the
// preference is trivial to re-set.
const VIEW_LS_KEY = 'trackarr.torrents.view';
/*
 * Œuvres d'abord : sans `v` dans l'URL, le catalogue se range par œuvre —
 * c'est ce qu'on cherche le plus souvent. La préférence mémorisée (ci-dessous,
 * au montage) et un `?v=simple` partagé passent devant.
 */
const view = ref<'simple' | 'grouped'>(
  (route.query.v as string) === 'simple' ? 'simple' : 'grouped'
);
import {
  detectMediaId,
  type DetectedMediaId,
  type MediaIdSource,
} from '~/utils/mediaIdDetect';

const mediaIdFilter = ref<{ source: MediaIdSource; id: string } | null>(
  (() => {
    const q = route.query;
    if (q.imdbid) return { source: 'imdb', id: String(q.imdbid) };
    if (q.tmdbid) return { source: 'tmdb', id: String(q.tmdbid) };
    if (q.tvdbid) return { source: 'tvdb', id: String(q.tvdbid) };
    return null;
  })()
);

const activeMediaId = computed<DetectedMediaId | null>(() => {
  const m = mediaIdFilter.value;
  if (!m) return null;
  return (
    detectMediaId(m.id) ?? {
      source: m.source,
      id: m.id,
      display: m.id,
      label:
        m.source === 'imdb' ? 'IMDb' : m.source === 'tmdb' ? 'TMDb' : 'TVDB',
    }
  );
});

const viewOptions = computed(() => [
  { value: 'grouped' as const, label: t('search.viewGrouped'), icon: 'ph:squares-four-bold' },
  { value: 'simple' as const, label: t('search.viewSimple'), icon: 'ph:list-bullets-bold' },
]);

// Fetch categories — flat list with subcategories nested.
const { data: categories } = await useFetch<Category[]>('/api/categories');




// Fetch torrents — driven by every filter slice via a computed query.
/*
 * La marque et les réglages du catalogue AVANT les requêtes : leurs `computed`
 * les lisent à la première évaluation (« Cannot access before initialization »).
 */
const branding = await useBranding();
const federated = computed(() => Boolean(branding.value?.federationEnabled));
/*
 * Les réglages du catalogue de l'instance : vue et tri à l'arrivée, taille de
 * page, facettes. Ils voyagent avec la marque, donc disponibles avant tout appel.
 */
const catalogue = computed(() => branding.value?.catalogue ?? {
  defaultView: 'grouped' as const,
  defaultSort: 'auto' as const,
  pageSize: 20,
  facets: ['category', 'resolution', 'source', 'codec', 'language', 'hdr', 'audio', 'year', 'options'],
});
if (!route.query.v) view.value = catalogue.value.defaultView;
const effectiveSort = computed<TorrentSortKey>(() => {
  if (sortBy.value) return sortBy.value;
  if (catalogue.value.defaultSort !== 'auto') return catalogue.value.defaultSort;
  return searchQuery.value.trim() ? 'relevance' : 'age';
});
// « Pertinence » n'est un choix que s'il y a un texte à classer.
const sortOptions = computed(() =>
  SORT_KEYS.filter((k) => k !== 'relevance' || searchQuery.value.trim() || effectiveSort.value === 'relevance'),
);

/** La requête du listing, nommée : « charger plus » la rejoue avec la page suivante. */
const torrentsQuery = computed(() => {
    const m = mediaIdFilter.value;
    return {
      // Coerce empty strings to undefined — the API's Zod schema requires
      // min(1) on `search` and `categoryId`, so passing the literal empty
      // string fails validation and the fetch returns 400.
      search: searchQuery.value || undefined,
      categoryId: selectedCategory.value || undefined,
      tag:
        selectedTags.value.length > 0
          ? selectedTags.value.join(',')
          : undefined,
      imdbid: m?.source === 'imdb' ? m.id : undefined,
      tmdbid: m?.source === 'tmdb' ? m.id : undefined,
      tvdbid: m?.source === 'tvdb' ? m.id : undefined,
      ...tokensToQuery(tokens.value),
      ...optionsToQuery(options.value),
      page: page.value,
      limit: catalogue.value.pageSize,
      sortBy: effectiveSort.value,
      order: sortOrder.value,
    };
});
const {
  data: torrentsData,
  pending,
  refresh: refreshTorrents,
} = await useFetch<{
  /**
   * Editorially pinned releases, page 1 only, under the same filters as the
   * flow. They are held OUT of `data` on every page, so a release appears
   * exactly once in a listing and the page count describes what can actually
   * be scrolled through.
   */
  pinned: TorrentWithStats[];
  data: TorrentWithStats[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}>('/api/torrents', {
  query: torrentsQuery,
  // Refetching is driven by the explicit watcher below rather than by `watch:`,
  // so that typing in one view does not also fetch pages for the other.
  watch: false,
  // The grouped view has its own endpoint; skip this one entirely rather than
  // fetching a window we will not read.
  immediate: view.value !== 'grouped',
});

/**
 * One group as the API serves it — a collapsed row, carrying no releases.
 * Those arrive per scope, on expansion, from `/api/torrents/group`.
 */
interface ServedGroup {
  key: string;
  work?: { title: string; year: number | null; posterUrl: string | null; type: string | null; tint?: string | null } | null;
  tagSlugs?: string[];
  firstScope?: GroupScope;
  source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
  externalId: string;
  releaseCount: number;
  latest: string;
  minSize: number;
  maxSize: number;
  leadName: string;
  categoryIds: string[];
  seedMin: number;
  seedMax: number;
  leechMin: number;
  leechMax: number;
  /** Group totals, which is what the listing sorts on. */
  seedTotal: number;
  leechTotal: number;
  completedTotal: number;
  totalSize: number;
  /** Oldest release, the other end of the age span. */
  oldest: string;
  scopes: Array<{ scope: GroupScope; units: number; latest: string }>;
  defaultScope: GroupScope;
  /**
   * How the row's releases split between the two catalogues. They overlap on
   * purpose — a release we hold that a partner also holds counts in both, and
   * once in `releaseCount`.
   */
  localCount: number;
  partnerCount: number;
  /** Partners contributing at least one release. */
  peerCount: number;
}

/**
 * Whether partner releases are folded into the rows.
 *
 * Defaults to everywhere, and costs nothing on an instance with no partners —
 * the server skips the mirror outright and answers the query it always did.
 * The toggle exists for the member who wants to see only what they can
 * download here and now, which is a real question and not the same one.
 *
 * Declared before the fetch on purpose: `useFetch` evaluates its query during
 * setup, and a `const` read from there before this line is a dead-zone crash.
 */
const sources = ref<'all' | 'local'>('all');

/**
 * Whether this instance has partners at all.
 *
 * The source toggle's guard read a bare `federated` that was declared
 * nowhere — `undefined`, so the control only showed once `sources` had
 * already been switched to `local`, which is the one state you cannot
 * reach without it. Same flag the admin panels and the palette read.
 */

// Fetch groups — the grouped view's own endpoint. It folds the WHOLE catalogue,
// not the page the flat listing happened to return, so its counts, episode sets
// and pagination describe the catalogue rather than the window.
const groupsQuery = computed(() => ({
    search: searchQuery.value || undefined,
    categoryId: selectedCategory.value || undefined,
    // Les tags, comme le listing plat. Ils manquaient ICI autant que dans le
    // schéma du endpoint : la vue groupée rendait le catalogue entier pour un
    // `?tag=2160p`, et rien ne le signalait puisque zod retire en silence ce
    // qu'il ne déclare pas. Le défaut était des deux côtés du fil.
    tag: selectedTags.value.length > 0 ? selectedTags.value.join(',') : undefined,
    sources: sources.value,
    imdbid: mediaIdFilter.value?.source === 'imdb' ? mediaIdFilter.value.id : undefined,
    tmdbid: mediaIdFilter.value?.source === 'tmdb' ? mediaIdFilter.value.id : undefined,
    tvdbid: mediaIdFilter.value?.source === 'tvdb' ? mediaIdFilter.value.id : undefined,
    ...tokensToQuery(tokens.value),
    ...optionsToQuery(options.value),
    page: page.value,
    limit: catalogue.value.pageSize,
    // Same keys as the flat listing: switching views keeps the order, even
    // though what each key means across a group is decided server-side.
    sortBy: effectiveSort.value,
    order: sortOrder.value,
}));
const {
  data: groupsData,
  pending: groupsPending,
  refresh: refreshGroups,
} = await useFetch<{
  groups: ServedGroup[];
  /** True when partner releases are in these rows. False on a lone instance. */
  merged: boolean;
  pagination: { page: number; limit: number; total: number; totalPages: number };
}>('/api/torrents/groups', {
  query: groupsQuery,
  watch: false,
  immediate: view.value === 'grouped',
});


// One watcher for both endpoints: whichever view is on screen is the one that
// refetches. Switching views is itself a trigger, so the first switch loads the
// side that was skipped at mount.
/*
 * Les mêmes critères que le listing, sans page ni tri : c'est ce que le rail
 * compte, et ce que les cartes d'œuvres passent à leurs releases dépliées.
 */
const committedFilterQuery = ref<Record<string, string | number | undefined>>({});
const workFilterQuery = computed(() => {
  const m = mediaIdFilter.value;
  return {
    search: searchQuery.value || undefined,
    categoryId: selectedCategory.value || undefined,
    tag: selectedTags.value.length > 0 ? selectedTags.value.join(',') : undefined,
    imdbid: m?.source === 'imdb' ? m.id : undefined,
    tmdbid: m?.source === 'tmdb' ? m.id : undefined,
    tvdbid: m?.source === 'tvdb' ? m.id : undefined,
    ...tokensToQuery(tokens.value),
    ...optionsToQuery(options.value),
  };
});
const {
  data: facets,
  pending: facetsPending,
  refresh: refreshFacets,
} = await useFetch<FacetsResponse>('/api/torrents/facets', {
  query: workFilterQuery,
  watch: false,
});

/*
 * Le texte tapé attend 250 ms de silence avant de relancer les trois lectures
 * (listing, facettes, groupes) ; les clics — puces, catégorie, tri, page —
 * partent tout de suite. Une lettre ne vaut pas trois requêtes.
 */
let typingTimer: ReturnType<typeof setTimeout> | null = null;
function refreshAll() {
  resetExtra();
  // Ce que les cartes d'œuvres dépliées interrogent : la requête telle qu'elle
  // est partie, pas la frappe en cours — sinon chaque touche rechargeait
  // chaque carte ouverte, sans le délai que la page s'accorde.
  committedFilterQuery.value = workFilterQuery.value;
  if (view.value === 'grouped') refreshGroups();
  else refreshTorrents();
  refreshFacets();
}
watch(searchQuery, () => {
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    typingTimer = null;
    refreshAll();
  }, 250);
});
onBeforeUnmount(() => {
  if (typingTimer) clearTimeout(typingTimer);
});
watch(
  [
    selectedCategory,
    selectedTags,
    mediaIdFilter,
    tokens,
    options,
    page,
    view,
    sources,
    sortBy,
    sortOrder,
  ],
  () => {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    refreshAll();
  }
);

// Trending — surface 10 latest torrents when there's no query.

/*
 * « Charger plus » : les pages suivantes s'ajoutent sous la première au lieu de
 * la remplacer, et la position ne bouge pas. Un changement de filtre ou de tri
 * repart de zéro.
 */
const extraTorrents = ref<TorrentWithStats[]>([]);
const extraGroups = ref<ServedGroup[]>([]);
const loadedPages = ref(1);
const loadingMore = ref(false);
/* La génération des pages ajoutées : `resetExtra()` l'incrémente, et une page
   partie avant un changement de filtre, de tri ou de vue est ignorée à l'arrivée. */
let extraGen = 0;
async function loadMore() {
  if (loadingMore.value) return;
  const next = page.value + loadedPages.value;
  if (next > pagination.value.pages) return;
  const gen = extraGen;
  loadingMore.value = true;
  try {
    if (view.value === 'grouped') {
      const res = await $fetch<{ groups: ServedGroup[] }>('/api/torrents/groups', {
        query: { ...groupsQuery.value, page: next },
      });
      if (gen !== extraGen) return;
      extraGroups.value = [...extraGroups.value, ...res.groups];
    } else {
      const res = await $fetch<{ data: TorrentWithStats[] }>('/api/torrents', {
        query: { ...torrentsQuery.value, page: next },
      });
      if (gen !== extraGen) return;
      extraTorrents.value = [...extraTorrents.value, ...res.data];
    }
    loadedPages.value += 1;
  } finally {
    loadingMore.value = false;
  }
}
function resetExtra() {
  extraGen += 1;
  extraTorrents.value = [];
  extraGroups.value = [];
  loadedPages.value = 1;
}
const torrents = computed(() => [...(torrentsData.value?.data ?? []), ...extraTorrents.value]);
const pinnedTorrents = computed(() => torrentsData.value?.pinned ?? []);

/**
 * Saving the current filter as an alert.
 *
 * Only when the filter has something in it that a stored search could act on —
 * a bare sort order is not a search, and saving one would produce a filter that
 * fires on every upload.
 */
const savedSearchNotifications = useNotificationStore();
const savingSearch = ref(false);
const canSaveSearch = computed(
  () =>
    !!searchQuery.value.trim() ||
    !!selectedCategory.value ||
    selectedTags.value.length > 0 ||
    tokens.value.length > 0 ||
    options.value.length > 0 ||
    // A filter by IMDb/TMDb/TVDB id counts. The route has accepted these three
    // since it was written and `/alerts` renders a chip for each, but the only
    // thing that creates a saved search never sent them — so the chips were
    // dead UI, and a member browsing one film's id could not save that watch at
    // all, which is exactly the search worth being told about.
    !!activeMediaId.value
);

async function saveCurrentSearch() {
  // The typed text makes the best label; failing that, the category name; and
  // failing both, a placeholder the member can recognise on the alerts page.
  const fromCategory = selectedCategory.value
    ? categoryLabel([selectedCategory.value])
    : null;
  // Two tag-only searches both became "Untitled search", and the alerts page is
  // read-and-delete by design — so they stayed indistinguishable forever.
  // Naming the criteria is what makes the fallback usable.
  const fromTags = selectedTags.value.length ? selectedTags.value.join(', ') : null;
  const fromMedia = activeMediaId.value
    ? `${activeMediaId.value.label} ${activeMediaId.value.display}`
    : null;
  const label = (
    searchQuery.value.trim() ||
    fromCategory ||
    fromTags ||
    fromMedia ||
    t('search.saveSearch.untitled')
  ).slice(0, 80);
  // Une recherche enregistrée ne connaît que des slugs : chaque jeton d'étiquette
  // y laisse son premier synonyme, les numéros et l'uploadeur n'y entrent pas.
  const savedTags = [...selectedTags.value, ...tokenSlugs(tokens.value)];
  savingSearch.value = true;
  try {
    await $fetch<{ id: string }>('/api/me/saved-searches', {
      method: 'POST',
      body: {
        label,
        query: searchQuery.value.trim() || undefined,
        categoryId: selectedCategory.value || undefined,
        tags: savedTags.length ? savedTags : undefined,
        // Les critères de la barre, pour que l'alerte reproduise la recherche.
        tagGroups: tokensToQuery(tokens.value).tagGroups,
        season: tokensToQuery(tokens.value).season ? Number(tokensToQuery(tokens.value).season) : undefined,
        episode: tokensToQuery(tokens.value).episode ? Number(tokensToQuery(tokens.value).episode) : undefined,
        year: tokensToQuery(tokens.value).year ? Number(tokensToQuery(tokens.value).year) : undefined,
        uploader: tokensToQuery(tokens.value).uploader,
        imdbId: mediaIdFilter.value?.source === 'imdb' ? mediaIdFilter.value.id : undefined,
        tmdbId: mediaIdFilter.value?.source === 'tmdb' ? mediaIdFilter.value.id : undefined,
        tvdbId: mediaIdFilter.value?.source === 'tvdb' ? mediaIdFilter.value.id : undefined,
      },
    });
    savedSearchNotifications.success(t('search.saveSearch.saved'));
  } catch (err: unknown) {
    // Mapped on the route's own `reason`, not echoed from its message. The two
    // 4xx bodies here are English sentences written for a log — "You can keep up
    // to 20 saved searches. Delete one first." — and echoing them put English in
    // front of a French member at the one moment they needed to understand what
    // to do next.
    const e = err as { data?: { reason?: string; max?: number } };
    const reason = e?.data?.reason;
    savedSearchNotifications.error(
      reason === 'limit'
        ? t('search.saveSearch.limit', { max: e?.data?.max ?? 20 })
        : reason === 'no-criteria'
          ? t('search.saveSearch.noCriteria')
          : t('search.saveSearch.failed')
    );
  } finally {
    savingSearch.value = false;
  }
}

// ── View-aware result state ──────────────────────────────────
//
// Both views render through the same header, empty state and pager, so each of
// those reads one accessor that answers for whichever view is on screen. The
// alternative — duplicating the chrome per view — is how the two drift apart.

const isLoading = computed(() =>
  view.value === 'grouped' ? groupsPending.value : pending.value
);

const pagination = computed(() => {
  if (view.value === 'grouped') {
    const p = groupsData.value?.pagination;
    return { page: p?.page ?? 1, pages: p?.totalPages ?? 1, total: p?.total ?? 0 };
  }
  return torrentsData.value?.pagination ?? { page: 1, pages: 1, total: 0 };
});

/** Rows on screen, whatever a "row" means in the current view. */
const resultCount = computed(() =>
  view.value === 'grouped' ? servedGroups.value.length : torrents.value.length
);

// Total size of the current page — the table displays per-row sizes; the
// header summary helps the user gauge "is this 100 GB or 5 TB" at a
// glance, matching the upstream screenshot's "4.193 To" pill.
//
// Zero in the grouped view, which hides the pill: a group carries only its
// smallest and largest release, so any total we could add up there would be
// the size of a selection nobody asked for. Better absent than invented.
const totalSize = computed(() =>
  view.value === 'grouped'
    ? 0
    : torrents.value.reduce((acc, t) => acc + (t.size || 0), 0)
);

const hasActiveQuery = computed(
  () =>
    Boolean(searchQuery.value) ||
    Boolean(selectedCategory.value) ||
    selectedTags.value.length > 0 ||
    tokens.value.length > 0 ||
    options.value.length > 0 ||
    Boolean(activeMediaId.value) ||
    // Sorting is a query too. Clicking "size" on the landing view means "show
    // me the biggest releases", which is a question about the catalogue — not
    // about the ten rows the trending teaser happens to be showing.
    isSorted.value
);

/** True once the user has moved off the default ordering. */
const isSorted = computed(() => sortBy.value !== null || sortOrder.value !== 'desc');

/**
 * The groups as served. No adaptation layer: the row component consumes the
 * API's shape directly, because there is no longer a client-side grouping for
 * it to be reconciled with.
 */
const servedGroups = computed(() => [...(groupsData.value?.groups ?? []), ...extraGroups.value]);
/*
 * Le nombre de la barre. En vue Releases, la liste plate met l'épinglée à part
 * et sa pagination ne la compte pas : « 35 torrents » sous un titre qui dit
 * « 36 releases ». Les facettes comptent tout ce qui répond, épinglée comprise.
 */
const shownTotal = computed(() =>
  view.value === 'grouped' ? pagination.value.total : facets.value?.total ?? pagination.value.total,
);
/* Sous le titre : ce que la recherche courante recouvre. */
const countLine = computed(() => {
  const f = facets.value;
  if (!f) return '';
  const parts = [t('search.count.releases', f.total)];
  if (view.value === 'grouped' && groupsData.value?.pagination) parts.push(t('search.count.works', groupsData.value.pagination.total));
  if (f.options.withSeeders > 0) parts.push(t('search.count.live', f.options.withSeeders));
  return parts.join(' · ');
});
const selectedCategoryName = computed(() =>
  selectedCategory.value ? categoryLabel([selectedCategory.value]) ?? '' : '',
);

/**
 * Resolve a group's category to a label here rather than handing the row the
 * whole table: the federated variant of the same row has slugs from a foreign
 * namespace and no table to look them up in.
 */
function categoryLabel(ids: string[]): string | null {
  for (const id of ids) {
    const cat = categoryById.value.get(id);
    if (cat) return cat.name;
  }
  return null;
}

/** Flat id → category, used by `categoryLabel`. */
const categoryById = computed(() => {
  const map = new Map<string, { name: string; slug: string }>();
  for (const c of categories.value ?? []) {
    map.set(c.id, { name: c.name, slug: c.slug });
    for (const sub of c.subcategories ?? []) {
      map.set(sub.id, { name: sub.name, slug: sub.slug });
    }
  }
  return map;
});


function handleSearch() {
  page.value = 1;
  updateUrl();
  pushRecent();
}

function handleCategorySelect(id: string) {
  selectedCategory.value = id;
  page.value = 1;
  updateUrl();
}

function goToPage(p: number) {
  page.value = p;
  updateUrl();
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

/** La requête d'URL que la page écrit — et ce qu'une recherche récente retient. */
function currentUrlQuery(): Record<string, string | number | undefined> {
  const m = mediaIdFilter.value;
  return {
      q: searchQuery.value || undefined,
      c: selectedCategory.value || undefined,
      tag:
        selectedTags.value.length > 0
          ? selectedTags.value.join(',')
          : undefined,
      imdbid: m?.source === 'imdb' ? m.id : undefined,
      tmdbid: m?.source === 'tmdb' ? m.id : undefined,
      tvdbid: m?.source === 'tvdb' ? m.id : undefined,
      ...tokensToUrl(tokens.value),
      o: options.value.length ? options.value.join(',') : undefined,
      p: page.value > 1 ? page.value : undefined,
      // Seule une vue différente du défaut de l'instance s'écrit.
      v: view.value !== catalogue.value.defaultView ? view.value : undefined,
      // Omitted while on the default so a plain listing keeps a clean URL.
      s: sortBy.value ?? undefined,
      d: sortOrder.value !== 'desc' ? sortOrder.value : undefined,
  };
}
function updateUrl() {
  router.replace({ query: currentUrlQuery() as Record<string, string> });
}

watch(view, (next) => {
  /*
   * Une bascule VOULUE repart de la première page et écrit l'URL. Un changement
   * que l'URL porte déjà — retour arrière, lien `?v=simple` du menu — n'est pas
   * une bascule : le réécrire effaçait le `p=3` vers lequel on revenait.
   */
  const urlView = str(route.query.v);
  const fromUrl = urlView ? urlView === next : next === catalogue.value.defaultView;
  if (!fromUrl) {
    page.value = 1;
    updateUrl();
  }
  // Persist the user's choice across reloads. We only touch localStorage
  // on the client; the early ref init runs identically on server and
  // client to avoid hydration mismatches.
  if (import.meta.client) {
    try {
      localStorage.setItem(VIEW_LS_KEY, next);
    } catch {
      // Storage might be disabled (Safari private mode, quota); a missing
      // persisted preference isn't worth surfacing to the user.
    }
  }
});

// Hydrate the view from localStorage once on mount, but only if the
// current URL doesn't pin a view explicitly. A shared `?v=grouped`
// link still beats the user's stored preference.
onMounted(() => {
  if (route.query.v) return;
  try {
    const stored = localStorage.getItem(VIEW_LS_KEY);
    if (stored === 'grouped' || stored === 'simple') {
      view.value = stored;
    }
  } catch {
    // No-op — see comment in the watcher above.
  }
});

function handleMediaIdSearch(detected: DetectedMediaId) {
  searchQuery.value = '';
  mediaIdFilter.value = { source: detected.source, id: detected.id };
  page.value = 1;
  updateUrl();
}

function clearMediaIdFilter() {
  mediaIdFilter.value = null;
  page.value = 1;
  updateUrl();
}

function toggleTag(slug: string) {
  if (selectedTags.value.includes(slug)) {
    selectedTags.value = selectedTags.value.filter((t) => t !== slug);
  } else {
    selectedTags.value = [...selectedTags.value, slug];
  }
  page.value = 1;
  updateUrl();
}



watch(
  () => route.query,
  (newQuery) => {
    /*
     * Deux gardes. La première : un `router.replace` que la page a elle-même
     * écrit revient ici une fois résolu — rien à relire. La seconde : quand le
     * membre est en train de taper, le champ est la vérité ; une navigation qui
     * se résout pendant la frappe (un clic sur le rail juste avant) ne doit pas
     * effacer ce qu'il vient d'écrire.
     */
    const own = currentUrlQuery();
    const normalize = (q: Record<string, unknown>) =>
      Object.entries(q)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${String(v)}`)
        .sort()
        .join('&');
    if (normalize(own) === normalize(newQuery as Record<string, unknown>)) return;
    const typing =
      import.meta.client &&
      (document.activeElement as HTMLElement | null)?.classList.contains('ts-input') === true;
    if (!typing) searchQuery.value = str(newQuery.q);
    selectedCategory.value = str(newQuery.c);
    selectedTags.value = str(newQuery.tag)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (newQuery.imdbid) {
      mediaIdFilter.value = { source: 'imdb', id: String(newQuery.imdbid) };
    } else if (newQuery.tmdbid) {
      mediaIdFilter.value = { source: 'tmdb', id: String(newQuery.tmdbid) };
    } else if (newQuery.tvdbid) {
      mediaIdFilter.value = { source: 'tvdb', id: String(newQuery.tvdbid) };
    } else {
      mediaIdFilter.value = null;
    }
    page.value = Math.max(1, parseInt(str(newQuery.p) || '1', 10) || 1);
    tokens.value = tokensFromQuery(newQuery as Record<string, unknown>);
    options.value = optionsFromQuery(newQuery.o);
    view.value = newQuery.v === 'simple' || newQuery.v === 'grouped' ? newQuery.v : catalogue.value.defaultView;
    // Le tri aussi : le retour arrière doit rendre l'ordre qu'on avait, pas le défaut.
    sortBy.value = sortKeyParam(newQuery.s);
    sortOrder.value = newQuery.d === 'asc' ? 'asc' : 'desc';
  },
  { deep: true }
);

useHead({
  title: () => t('search.pageTitle'),
});
</script>

<style scoped>
.search-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 0.35rem 0.9rem;
  min-width: 0;
}
.search-count {
  display: block;
  margin: 0;
  min-height: 1em;
  color: rgb(var(--accent-warm-text) / 1);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 500;
  line-height: 1;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted) / 1);
}

/* =============================================================================
 * Torrents hub — chip-driven category navigation à la C411.
 *
 * Uses the existing brutalist-techno tokens (Inter + JetBrains Mono, mono
 * accent on `--accent`) but reorganises the page around inline category
 * chips with a conditional sub-row — sub-categories only render once the
 * user has selected (or deep-linked into) their parent.
 *
 * (Originally lived at /search; merged into /torrents so the listing,
 *  search, and upload flow share the same surface.)
 * ============================================================================= */

.search-shell {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  padding-bottom: 4rem;
}

/* ─── Hero ───────────────────────────────────────────────── */
.search-hero {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
/* Le grain de la fiche, très bas, sur l'en-tête seulement : la page a une
   matière au lieu d'un fond plat. Rien à cliquer dessous. */
.search-hero::before {
  content: '';
  position: absolute;
  inset: -1.5rem -1rem 0;
  z-index: -1;
  pointer-events: none;
  border-radius: var(--radius-xl);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0 0.5 0 0 0 0.05 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  mask-image: linear-gradient(rgb(0 0 0 / 1), rgb(0 0 0 / 0));
  -webkit-mask-image: linear-gradient(rgb(0 0 0 / 1), rgb(0 0 0 / 0));
}
.search-hero-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.search-hero-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
}
.search-title {
  margin: 0;
  font-size: clamp(1.25rem, 3vw, 1.625rem);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: calc(-0.02em * var(--tracking-scale));
  color: rgb(var(--fg-strong));
}
.search-title-faint {
  color: rgb(var(--fg-muted));
  font-weight: 700;
}

/* Primary CTA — solid fill that anchors the hero. The icon-first layout
   matches the brutalist-techno control row and clearly reads as "the
   action" next to the more neutral mode toggle. */
.upload-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.95rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--accent-fg));
  background: rgb(var(--accent));
  border: 1px solid rgb(var(--accent));
  border-radius: var(--radius-pill);
  text-decoration: none;
  cursor: pointer;
  transition: background var(--dur-2), border-color var(--dur-2), transform var(--dur-2);
}
.upload-cta:hover {
  background: rgb(var(--accent-hover));
  border-color: rgb(var(--accent-hover));
  transform: translateY(-1px);
}
.upload-cta:active {
  transform: translateY(0);
}

/* Toggle Simple / Grouped — segmented pill, mirrors the screenshot's
   "Simple / Groupé" control. Active state inverts to the accent fill. */
.search-mode {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-pill);
  padding: 3px;
  background: rgb(var(--bg-surface));
}
.search-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 700;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  border-radius: var(--radius-pill);
  cursor: pointer;
  transition: all var(--dur-2);
}
.search-mode-btn:hover {
  color: rgb(var(--fg-strong));
}
.search-mode-btn--on {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
}
.search-mode-btn--on:hover {
  color: rgb(var(--accent-fg));
}

.search-meta-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.65rem;
}

/* ─── Results header ─────────────────────────────────────── */
/* ── La barre collante des filtres ──────────────────────────────────────── */
.rbar {
  position: sticky;
  top: calc(var(--header-total) + 0.5rem);
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem 1rem;
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-lg);
  background: rgb(var(--bg-surface) / 0.96);
  backdrop-filter: blur(10px);
  box-shadow: 0 8px 24px -18px rgb(var(--shadow-color) / var(--shadow-strength));
}
.rbar-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  min-width: 0;
}
.rbar-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  height: 1.85rem;
  padding: 0 0.55rem 0 0.65rem;
  border-radius: var(--radius-pill);
  border: 1px solid rgb(var(--line-default) / 1);
  background: rgb(var(--bg-inset) / 1);
  color: rgb(var(--fg-strong) / 1);
  font-size: 0.75rem;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  transition: border-color var(--dur-1) var(--ease-standard), background-color var(--dur-1) var(--ease-standard);
}
.rbar-chip:hover {
  border-color: rgb(var(--danger) / 0.5);
  background: rgb(var(--danger) / 0.08);
}
.rbar-chip :deep(svg) {
  width: 0.65rem;
  height: 0.65rem;
  color: rgb(var(--fg-muted) / 1);
}
.rbar-chip:hover :deep(svg) {
  color: rgb(var(--danger) / 1);
}
.rbar-chip--token {
  border-color: rgb(var(--accent-warm) / 0.35);
  background: rgb(var(--accent-warm) / 0.1);
}
.rbar-chip-k {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted) / 1);
}
.rbar-chip--token .rbar-chip-k {
  color: rgb(var(--accent-warm-text) / 1);
}
.rbar-clear {
  height: 1.85rem;
  padding: 0 0.5rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgb(var(--fg-faint) / 1);
  border-radius: var(--radius-sm);
}
.rbar-clear:hover {
  color: rgb(var(--fg-strong) / 1);
}
.rbar-none {
  font-size: 0.75rem;
  color: rgb(var(--fg-faint) / 1);
}
.rbar-sum {
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted) / 1);
}
.rbar-sum strong {
  font-weight: 600;
  color: rgb(var(--fg-strong) / 1);
}
.rbar-tools {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-left: auto;
}
.rbar-sort {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
}
.rbar-sort-k {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted) / 1);
}
.rbar-select {
  height: 2rem;
  padding: 0 1.75rem 0 0.6rem;
  border: 1px solid rgb(var(--line-field) / 1);
  border-radius: var(--radius-sm);
  background-color: rgb(var(--bg-inset) / 1);
  background-image: linear-gradient(45deg, transparent 50%, rgb(var(--fg-muted) / 1) 50%),
    linear-gradient(135deg, rgb(var(--fg-muted) / 1) 50%, transparent 50%);
  background-position: calc(100% - 0.95rem) 50%, calc(100% - 0.65rem) 50%;
  background-size: 0.3rem 0.3rem, 0.3rem 0.3rem;
  background-repeat: no-repeat;
  appearance: none;
  -webkit-appearance: none;
  color: rgb(var(--fg-strong) / 1);
  font-size: 0.75rem;
  cursor: pointer;
}
.rbar-ico,
.rbar-density button {
  display: inline-grid;
  place-items: center;
  width: 2rem;
  height: 2rem;
  border-radius: var(--radius-sm);
  color: rgb(var(--fg-muted) / 1);
  transition: background-color var(--dur-1) var(--ease-standard), color var(--dur-1) var(--ease-standard);
}
.rbar-ico :deep(svg),
.rbar-density :deep(svg) {
  width: 1rem;
  height: 1rem;
}
.rbar-ico {
  border: 1px solid rgb(var(--line-field) / 1);
  background: rgb(var(--bg-inset) / 1);
}
.rbar-ico:hover,
.rbar-density button:hover {
  color: rgb(var(--fg-strong) / 1);
  background: rgb(var(--bg-hover) / 1);
}
.rbar-density {
  display: inline-flex;
  padding: 0.15rem;
  gap: 0.1rem;
  border: 1px solid rgb(var(--line-field) / 1);
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset) / 1);
}
.rbar-density button {
  width: 1.75rem;
  height: 1.6rem;
  border-radius: calc(var(--radius-sm) - 2px);
}
.rbar-density button.is-on {
  background: rgb(var(--bg-surface) / 1);
  color: rgb(var(--accent-warm-text) / 1);
  box-shadow: 0 1px 2px rgb(var(--shadow-color) / var(--shadow-strength));
}
@media (max-width: 40rem) {
  .rbar {
    position: static;
    backdrop-filter: none;
    background: rgb(var(--bg-surface) / 1);
  }
  .rbar-sort-k {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .rbar-chip,
  .rbar-ico,
  .rbar-density button {
    transition: none;
  }
}

/* Where the rows draw from. Segmented rather than a checkbox: both states are
   a real answer, and neither is a deviation from the other. Cyan for the side
   that reaches outside, the same hue every federated signal uses. */
.src-toggle {
  display: inline-flex;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  overflow: hidden;
}
.src-toggle button {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 2px 7px;
  font-size: 0.625rem;
  font-weight: 500;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: background var(--dur-1) ease, color var(--dur-1) ease;
}
.src-toggle button:hover {
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated) / 0.6);
}
.src-toggle button.src-on {
  color: rgb(125 211 252);
  background: rgb(56 189 248 / 0.14);
}
.src-toggle button:last-child.src-on {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}

.results-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.8rem;
  padding: 4rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-surface));
}
.results-loading svg {
  color: rgb(var(--fg-muted));
}
.results-loading p {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ─── Bottom pagination ─────────────────────────────────── */
.results-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  margin-top: 1rem;
  padding-top: 0.75rem;
  border-top: 1px solid rgb(var(--line-default));
}
.results-foot-summary {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-muted));
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
}
.results-foot-summary strong {
  color: rgb(var(--fg-strong));
}


/* ─── media-id chip (kept from previous design) ────────── */
.media-id-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem 0.3rem 0.65rem;
  border-radius: var(--radius-pill);
  border: 1px solid;
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.06em * var(--tracking-scale));
  text-transform: uppercase;
}
.media-id-chip--imdb {
  background: rgba(245, 197, 24, 0.1);
  border-color: rgba(245, 197, 24, 0.45);
}
.media-id-chip--tmdb {
  background: rgba(1, 180, 228, 0.1);
  border-color: rgba(1, 180, 228, 0.45);
}
.media-id-chip--tvdb {
  background: rgba(108, 209, 97, 0.1);
  border-color: rgba(108, 209, 97, 0.45);
}
.media-id-chip-tag {
  font-weight: 800;
}
  /* La teinte reste sur le fond et la bordure — donc l'identité média
     (IMDb, TMDb) et la distinction de catégorie survivent — mais le LIBELLÉ
     passe sur un jeton de premier plan. Une couleur de marque n'a pas de raison
     d'être lisible sur les deux thèmes : `#f5c518` sur blanc mesure 1,50:1.
     C'est exactement ce que `tagBadgeStyle()` fait déjà pour les tags, où la
     couleur est choisie par un opérateur et où le texte reste donc toujours
     lisible. */
.media-id-chip--imdb .media-id-chip-tag {
  color: rgb(var(--fg-default));
}
.media-id-chip--tmdb .media-id-chip-tag {
  color: rgb(var(--fg-default));
}
.media-id-chip--tvdb .media-id-chip-tag {
  color: rgb(var(--online));  /* jeton sémantique : cette teinte était figée sur le thème sombre */
}
.media-id-chip-id {
  font-family: var(--font-mono);
  text-transform: none;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
  font-weight: 600;
  font-size: 0.6875rem;
}
.media-id-chip-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: var(--radius-pill);
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: all var(--dur-2) ease;
}
.media-id-chip-close:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}

/* ─── Mobile reflow ─────────────────────────────────────── */
@media (max-width: 640px) {
  .search-hero-row {
    align-items: flex-start;
  }
  .search-hero-actions {
    width: 100%;
    justify-content: space-between;
  }
  .upload-cta {
    flex: 1;
    justify-content: center;
  }
  .search-mode {
    flex-shrink: 0;
  }
  .search-mode-btn {
    flex: 1;
    justify-content: center;
  }
}

/* ── Rail + résultats ────────────────────────────────────────────────────── */
.layout {
  display: grid;
  grid-template-columns: 15.5rem minmax(0, 1fr);
  gap: 1.75rem;
  align-items: start;
}
.rail {
  position: sticky;
  top: calc(var(--header-total) + 1rem);
  max-height: calc(100vh - var(--header-total) - 1.5rem);
  overflow-y: auto;
  scrollbar-width: thin;
  padding-right: 0.25rem;
}
.results {
  min-width: 0;
  container-type: inline-size;
}
.results > .rbar {
  margin-top: 0;
}
@media (max-width: 68.75rem) {
  .layout {
    grid-template-columns: 1fr;
    gap: 1rem;
  }
  .rail {
    display: none;
    position: static;
    max-height: none;
    padding: 0.9rem;
    border: 1px solid rgb(var(--line-default) / 1);
    border-radius: var(--radius-lg);
    background: rgb(var(--bg-surface) / 1);
  }
  .rail--open {
    display: block;
  }
  .rail--open :deep(.cf) {
    grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
    gap: 1rem 1.5rem;
  }
}

/* ── L'état vide qui propose ─────────────────────────────────────────────── */
.empty {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1rem 2rem;
  align-items: center;
  margin-top: 1rem;
  padding: 1.5rem 1.5rem 1.4rem;
  border: 1px dashed rgb(var(--line-strong) / 1);
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface) / 0.6);
}
.empty-title {
  margin: 0 0 0.3rem;
  font-family: var(--font-display);
  font-style: italic;
  font-weight: 500;
  font-size: 1.25rem;
  line-height: 1.1;
  color: rgb(var(--fg-strong) / 1);
  overflow-wrap: anywhere;
}
.empty-hint {
  margin: 0;
  max-width: 60ch;
  color: rgb(var(--fg-muted) / 1);
}
.empty-list {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin: 0.8rem 0 0;
  padding: 0;
  list-style: none;
}
.empty-rel {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.85rem;
  padding: 0 0.65rem;
  border: 1px solid rgb(var(--line-strong) / 1);
  border-radius: var(--radius-pill);
  font-size: 0.75rem;
  font-weight: 600;
  color: rgb(var(--fg-default) / 1);
  transition: border-color var(--dur-1) var(--ease-standard), background-color var(--dur-1) var(--ease-standard);
}
.empty-rel:hover {
  border-color: rgb(var(--fg-muted) / 1);
  background: rgb(var(--bg-hover) / 1);
}
.empty-rel b {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--online) / 1);
}
.empty-act {
  display: grid;
  gap: 0.5rem;
}
.empty-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0 1rem;
  border-radius: var(--radius-pill);
  font-size: 0.8125rem;
  font-weight: 700;
  text-decoration: none;
  white-space: nowrap;
  transition: transform var(--dur-1) var(--ease-standard), opacity var(--dur-1) var(--ease-standard);
}
.empty-btn :deep(svg) {
  width: 0.9rem;
  height: 0.9rem;
}
.empty-btn:active {
  transform: scale(0.98);
}
.empty-btn--primary {
  background: rgb(var(--fg-default) / 1);
  color: rgb(var(--bg-base) / 1);
}
.empty-btn--gold {
  border: 1px solid rgb(var(--accent-warm) / 0.6);
  background: rgb(var(--accent-warm) / 0.12);
  color: rgb(var(--accent-warm-text) / 1);
}
.empty-btn:disabled {
  opacity: 0.6;
  cursor: progress;
}
@media (max-width: 40rem) {
  .empty {
    grid-template-columns: 1fr;
  }
}

/* ── La feuille de filtres et son bouton, écran étroit seulement ─────────── */
.sheet-head,
.sheet-apply,
.sheet-backdrop,
.m-fab {
  display: none;
}
@media (max-width: 68.75rem) {
  .m-fab {
    position: fixed;
    right: 1rem;
    bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
    z-index: 55;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    padding: 0 1rem;
    border-radius: var(--radius-pill);
    background: rgb(var(--fg-default) / 1);
    color: rgb(var(--bg-base) / 1);
    font-size: 0.8125rem;
    font-weight: 700;
    box-shadow: 0 12px 24px -8px rgb(var(--shadow-color) / 0.6);
  }
  .m-fab :deep(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }
  .m-fab-n {
    padding: 0 0.4rem;
    border-radius: var(--radius-pill);
    background: rgb(var(--accent-warm) / 1);
    color: rgb(var(--accent-warm-fg) / 1);
    font-family: var(--font-mono);
    font-size: 0.625rem;
    font-weight: 800;
    line-height: 1.2rem;
  }
  .sheet-backdrop {
    display: block;
    position: fixed;
    inset: 0;
    z-index: 59;
    background: rgb(var(--bg-base) / 0.6);
    backdrop-filter: blur(2px);
  }
  .rail--open {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 60;
    max-height: 82dvh;
    overflow-y: auto;
    padding: 0.75rem 0.9rem calc(0.75rem + env(safe-area-inset-bottom, 0px));
    border: 0;
    border-top: 1px solid rgb(var(--line-strong) / 1);
    border-radius: 20px 20px 0 0;
    background: rgb(var(--bg-elevated) / 1);
    box-shadow: 0 -20px 40px -12px rgb(var(--shadow-color) / var(--shadow-strength));
    animation: sheet-in var(--dur-4) var(--ease-emphasis) both;
  }
  @keyframes sheet-in {
    from {
      transform: translateY(1.5rem);
      opacity: 0;
    }
  }
  .rail--open::before {
    content: '';
    display: block;
    width: 2.5rem;
    height: 4px;
    margin: 0 auto 0.6rem;
    border-radius: 2px;
    background: rgb(var(--line-strong) / 1);
  }
  .sheet-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.6rem;
  }
  .sheet-title {
    margin: 0 auto 0 0;
    font-family: var(--font-display);
    font-style: italic;
    font-weight: 500;
    font-size: 1.1rem;
    outline: none;
  }
  .sheet-clear {
    font-size: 0.75rem;
    font-weight: 600;
    color: rgb(var(--fg-muted) / 1);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .sheet-close {
    display: inline-grid;
    place-items: center;
    width: 2.25rem;
    height: 2.25rem;
    border-radius: 50%;
    color: rgb(var(--fg-muted) / 1);
  }
  .sheet-close:hover {
    background: rgb(var(--bg-hover) / 1);
    color: rgb(var(--fg-strong) / 1);
  }
  .sheet-close :deep(svg) {
    width: 0.9rem;
    height: 0.9rem;
  }
  .sheet-apply {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: center;
    align-items: center;
    width: 100%;
    min-height: 2.75rem;
    margin-top: 0.75rem;
    border-radius: var(--radius-pill);
    background: rgb(var(--fg-default) / 1);
    color: rgb(var(--bg-base) / 1);
    font-size: 0.8125rem;
    font-weight: 700;
    box-shadow: 0 -8px 16px -8px rgb(var(--bg-elevated) / 1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .rail--open {
    animation: none;
  }
  .empty-rel,
  .empty-btn {
    transition: none;
  }
}

/* ── Revue : actualisation sans clignotement, feuille et cibles tactiles ─── */
.is-refreshing > :not(.results-loading) {
  opacity: 0.6;
  transition: opacity var(--dur-2) var(--ease-standard);
}
@media (min-width: 68.8rem) {
  /* Le titre « Filtres » reste dans l'arbre d'accessibilité (h1 → h2 → h3) ;
     seuls ses boutons disparaissent : ils n'ont de sens que dans la feuille. */
  .sheet-head {
    display: block;
  }
  .sheet-head .rail-title {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
  }
  .sheet-head .sheet-clear,
  .sheet-head .sheet-close {
    display: none;
  }
}
@media (max-width: 68.75rem) {
  /* Le bouton flottant ne doit pas couvrir la dernière ligne ni le pied de page. */
  .layout {
    margin-bottom: 4.5rem;
  }
}
@media (pointer: coarse) {
  .rbar-density button {
    width: 2.25rem;
    height: 2.1rem;
  }
  .rbar-ico,
  .rbar-select {
    height: 2.5rem;
  }
  .rbar-chip {
    height: 2.25rem;
  }
  .sheet-clear {
    min-height: 2.25rem;
    padding: 0 0.5rem;
  }
}

.rbar-defaults {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  text-decoration: none;
}
.rbar-defaults :deep(svg) {
  width: 0.75rem;
  height: 0.75rem;
}
.rbar-defaults--on {
  color: rgb(var(--accent-warm-text) / 1);
}
.empty-dym {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.8rem 0 0;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted) / 1);
}
.empty-rel--dym {
  color: rgb(var(--accent-warm-text) / 1);
  border-color: rgb(var(--accent-warm) / 0.5);
}

/* ── Squelettes : la forme des cartes à venir, en gris qui respire ────────── */
.results-loading {
  display: grid;
  gap: 0.55rem;
  padding: 0;
  border: 0;
  background: transparent;
}
.skel {
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr);
  grid-template-rows: auto auto;
  gap: 0.4rem 0.9rem;
  align-items: center;
  padding: 0.65rem 0.9rem 0.65rem 1rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-xl);
  background: rgb(var(--bg-surface) / 1);
  animation: skel-in var(--dur-3) var(--ease-standard) both;
  animation-delay: calc(var(--i, 0) * 60ms);
}
.skel > * {
  border-radius: var(--radius-xs);
  background: linear-gradient(90deg, rgb(var(--bg-inset) / 1), rgb(var(--bg-hover) / 1), rgb(var(--bg-inset) / 1));
  background-size: 200% 100%;
  animation: skel-shimmer 1.4s linear infinite;
}
.skel-pst {
  grid-row: 1 / 3;
  width: 56px;
  height: 84px;
  border-radius: var(--radius-sm);
}
.skel-l--t {
  height: 1.1rem;
  width: 55%;
  align-self: end;
}
.skel-l--m {
  height: 0.7rem;
  width: 35%;
  align-self: start;
}
@keyframes skel-in {
  from {
    opacity: 0;
  }
}
@keyframes skel-shimmer {
  to {
    background-position: -200% 0;
  }
}
/* ── La barre collante : une ombre quand elle colle, rien posée ─────────────── */
.rbar-sentinel {
  height: 1px;
  margin-top: -1px;
}
.rbar {
  box-shadow: none;
  transition: box-shadow var(--dur-2) var(--ease-standard);
}
.rbar--stuck {
  box-shadow: 0 10px 24px -16px rgb(var(--shadow-color) / var(--shadow-strength));
}
/* ── Les outils de la feuille : visibles sur écran étroit seulement ────────── */
.sheet-tools {
  display: none;
}
@media (max-width: 68.75rem) {
  .sheet-tools {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid rgb(var(--line-default) / 1);
  }
  .sheet-tools .rbar-sort {
    flex: 1;
    min-width: 0;
  }
  .sheet-tools .rbar-select {
    width: 100%;
  }
  .rbar > .rbar-tools {
    display: none;
  }
}
@media (prefers-reduced-motion: reduce) {
  .skel,
  .skel > * {
    animation: none;
  }
  .rbar {
    transition: none;
  }
}
</style>
