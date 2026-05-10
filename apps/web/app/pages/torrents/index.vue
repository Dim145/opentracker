<template>
  <div class="search-shell">
    <!-- ── Hero ──────────────────────────────────────────────── -->
    <header class="search-hero">
      <div class="search-hero-row">
        <h1 class="search-title">
          {{ $t('search.titleMain') }} <span class="search-title-faint">{{ $t('search.titleAccent') }}</span>
        </h1>
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

      <SearchBar
        v-model="searchQuery"
        :placeholder="$t('search.searchPlaceholder')"
        size="lg"
        :loading="pending"
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

        <button
          type="button"
          class="filters-toggle"
          :class="{ 'filters-toggle--on': filtersOpen }"
          :aria-expanded="filtersOpen"
          aria-controls="search-filter-panel"
          @click="filtersOpen = !filtersOpen"
        >
          <Icon :name="filtersOpen ? 'ph:funnel-fill' : 'ph:funnel'" />
          {{ filtersOpen ? $t('torrents.hideFilters') : $t('torrents.showFilters') }}
          <span v-if="selectedTags.length > 0" class="filters-toggle-count">
            {{ selectedTags.length }}
          </span>
        </button>
      </div>
    </header>

    <!-- ── Categories (root row) ─────────────────────────────── -->
    <section class="cats">
      <p class="cats-eyebrow">{{ $t('common.category') }}</p>
      <div class="cats-row">
        <button
          type="button"
          class="cat-pill"
          :class="{ 'cat-pill--on': !selectedCategory }"
          @click="handleCategorySelect('')"
        >
          <Icon name="ph:asterisk-bold" />
          <span>{{ $t('common.all') }}</span>
        </button>
        <button
          v-for="cat in rootCategories"
          :key="cat.id"
          type="button"
          class="cat-pill"
          :class="{
            'cat-pill--on': selectedCategory === cat.id || hasActiveSub(cat),
          }"
          @click="handleCategorySelect(cat.id)"
        >
          <Icon :name="categoryIcon(cat.slug)" />
          <span>{{ cat.name }}</span>
        </button>
      </div>

      <!-- Sub-categories — only render when the active root has children. -->
      <Transition name="subs">
        <div v-if="visibleSubcats.length > 0" class="cats-row cats-row--sub">
          <button
            v-for="sub in visibleSubcats"
            :key="sub.id"
            type="button"
            class="cat-pill cat-pill--sub"
            :class="{ 'cat-pill--on': selectedCategory === sub.id }"
            @click="handleCategorySelect(sub.id)"
          >
            <span>{{ sub.name }}</span>
          </button>
        </div>
      </Transition>
    </section>

    <!-- ── Filters panel ─────────────────────────────────────── -->
    <Transition name="panel">
      <div
        v-if="filtersOpen"
        id="search-filter-panel"
        class="filter-panel"
      >
        <div class="filter-panel-head">
          <p class="cats-eyebrow">{{ $t('search.tags') }}</p>
          <button
            v-if="selectedTags.length > 0"
            type="button"
            class="filter-panel-clear"
            @click="clearTagFilters"
          >
            {{ $t('search.clear') }}
          </button>
        </div>
        <div
          v-if="(allTags?.length ?? 0) === 0"
          class="filter-panel-empty"
        >
          {{ $t('search.noTags') }}
        </div>
        <div v-else class="filter-panel-tags">
          <button
            v-for="tag in allTags"
            :key="tag.id"
            type="button"
            class="tag-toggle"
            :class="{ 'tag-toggle--active': selectedTags.includes(tag.slug) }"
            :style="
              selectedTags.includes(tag.slug)
                ? activeTagStyle(tag)
                : undefined
            "
            @click="toggleTag(tag.slug)"
          >
            <span
              class="inline-block w-2 h-2 rounded-full"
              :style="{ backgroundColor: tag.color }"
            />
            {{ tag.name }}
          </button>
        </div>
      </div>
    </Transition>

    <!-- ── Results header (stats + pagination top) ─────────── -->
    <div
      v-if="hasActiveQuery && pagination.total > 0"
      class="results-head"
    >
      <div class="results-stats">
        <span class="results-stat">
          <Icon name="ph:hard-drive-bold" />
          <strong>{{ formatSize(totalSize) }}</strong>
        </span>
        <span class="results-stat-sep" />
        <span class="results-stat">
          <strong>{{ pagination.total }}</strong>
          {{ $t('search.torrentCount', pagination.total) }}
        </span>
      </div>
      <Pager
        v-if="pagination.pages > 1"
        :page="pagination.page"
        :pages="pagination.pages"
        @go="goToPage"
      />
    </div>

    <!-- ── Results body ──────────────────────────────────────── -->
    <section v-if="hasActiveQuery">
      <div v-if="pending" class="results-loading">
        <Icon name="ph:circle-notch" class="animate-spin h-8 w-8" />
        <p>{{ $t('search.searchingDatabase') }}</p>
      </div>
      <div v-else-if="torrents.length === 0" class="results-empty">
        <Icon name="ph:magnifying-glass-x" class="results-empty-icon" />
        <h3>{{ $t('search.noResults') }}</h3>
        <p>{{ $t('search.noResultsHint') }}</p>
      </div>
      <template v-else>
        <!-- Simple: classic table -->
        <div v-if="view === 'simple'" class="card overflow-hidden">
          <div class="overflow-x-auto">
            <TorrentTable :torrents="torrents" :compact="false" />
          </div>
        </div>
        <!-- Grouped: cluster releases by TMDb id, fall back to solo for
             un-tagged torrents. The whole card is the toggle when there's
             more than one release; solo cards behave like a normal row
             link. Poster comes from TMDb (cached); we soft-fade it in once
             the lookup resolves so the layout doesn't jump. -->
        <div v-else class="grouped-list">
          <article
            v-for="group in groupedResults"
            :key="group.key"
            class="release-group"
            :class="{
              'release-group--solo': !group.tmdbBare,
              'release-group--open': expandedGroups.has(group.key),
            }"
          >
            <component
              :is="group.tmdbBare && group.releases.length > 1 ? 'button' : 'div'"
              :type="group.tmdbBare && group.releases.length > 1 ? 'button' : undefined"
              class="release-group-head"
              :aria-expanded="
                group.tmdbBare && group.releases.length > 1
                  ? expandedGroups.has(group.key)
                  : undefined
              "
              @click="
                group.releases.length > 1
                  ? toggleGroup(group.key)
                  : navigateTo(`/torrents/${group.lead.infoHash}`)
              "
            >
              <!-- Poster slot — only renders when we have a TMDb id and
                   the lookup is configured. While the lookup is in
                   flight we show a shimmering skeleton; on success the
                   image fades in; on miss / TMDb-disabled we drop the
                   poster column entirely so the head reflows full-width
                   like a solo card. -->
              <figure
                v-if="group.tmdbBare && (isPosterLoading(group) || posterFor(group))"
                class="release-poster"
              >
                <img
                  v-if="posterFor(group)?.posterUrl"
                  :src="posterFor(group)!.posterUrl!"
                  :alt="posterFor(group)?.title || group.fallbackTitle"
                  loading="lazy"
                  decoding="async"
                />
                <Icon
                  v-else-if="posterFor(group)"
                  name="ph:image-broken-bold"
                  class="release-poster-placeholder"
                />
                <span v-else class="release-poster-skeleton" />
              </figure>

              <div class="release-group-body">
                <span class="release-group-eyebrow">
                  <Icon
                    :name="categoryIcon(group.lead.category?.slug || 'other')"
                  />
                  {{ group.lead.category?.name || $t('search.uncategorised') }}
                  <template v-if="group.tmdbBare">
                    <span class="results-stat-sep" />
                    <span class="release-group-tmdb">
                      <Icon name="ph:popcorn-fill" class="release-group-tmdb-icon" />
                      TMDb {{ group.tmdbType ? `· ${group.tmdbType.toUpperCase()}` : '' }}
                    </span>
                  </template>
                </span>

                <h3 class="release-group-title">
                  <template v-if="posterFor(group)?.title">
                    {{ posterFor(group)?.title }}
                    <span
                      v-if="posterFor(group)?.year"
                      class="release-group-year"
                      >({{ posterFor(group)?.year }})</span
                    >
                  </template>
                  <template
                    v-else-if="group.tmdbBare && isPosterLoading(group)"
                  >
                    <span class="release-group-title-loading">
                      {{ $t('search.loadingTitle') }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="release-group-title-mono">
                      {{ group.fallbackTitle }}
                    </span>
                  </template>
                </h3>

                <p
                  v-if="posterFor(group)?.overview"
                  class="release-group-overview"
                >
                  {{ posterFor(group)!.overview }}
                </p>

                <p class="release-group-meta">
                  <span>
                    <strong>{{ group.releases.length }}</strong>
                    {{ $t('search.releaseCount', group.releases.length) }}
                  </span>
                  <span class="results-stat-sep" />
                  <span>{{ formatSize(group.totalSize) }}</span>
                  <span class="results-stat-sep" />
                  <span class="release-group-meta-seed">
                    <Icon name="ph:arrow-up-bold" class="text-[10px]" />
                    {{ group.totalSeeders }}
                  </span>
                  <span
                    v-if="posterFor(group)?.voteAverage"
                    class="results-stat-sep"
                  />
                  <span
                    v-if="posterFor(group)?.voteAverage"
                    class="release-group-rating"
                  >
                    <Icon name="ph:star-fill" />
                    {{ posterFor(group)!.voteAverage!.toFixed(1) }}
                  </span>
                </p>
              </div>

              <Icon
                v-if="group.releases.length > 1"
                name="ph:caret-down-bold"
                class="release-group-chev"
                :class="{
                  'release-group-chev--up': expandedGroups.has(group.key),
                }"
              />
            </component>

            <!-- Releases — always show the lead row in solo cards (it IS
                 the result), and only show the rest when expanded. -->
            <Transition name="releases">
              <ul
                v-if="
                  !group.tmdbBare ||
                  expandedGroups.has(group.key) ||
                  group.releases.length === 1
                "
                class="release-list"
              >
                <li
                  v-for="t in group.tmdbBare && expandedGroups.has(group.key)
                    ? group.releases
                    : !group.tmdbBare
                      ? group.releases
                      : group.releases.slice(0, 1)"
                  :key="t.id"
                  class="release-row"
                  @click.stop="navigateTo(`/torrents/${t.infoHash}`)"
                >
                  <span class="release-name" :title="t.name">{{ t.name }}</span>
                  <span class="release-pills">
                    <span class="stat-badge stat-seeders">
                      <Icon name="ph:arrow-up-bold" class="text-[8px]" />
                      {{ t.stats.seeders }}
                    </span>
                    <span class="stat-badge stat-leechers">
                      <Icon name="ph:arrow-down-bold" class="text-[8px]" />
                      {{ t.stats.leechers }}
                    </span>
                    <span class="release-size">{{ formatSize(t.size) }}</span>
                    <span class="release-age">{{ formatAge(t.createdAt) }}</span>
                  </span>
                </li>
              </ul>
            </Transition>
          </article>
        </div>
      </template>

      <!-- Bottom pagination -->
      <div v-if="pagination.pages > 1 && torrents.length > 0" class="results-foot">
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
    <section v-else class="trending">
      <p class="cats-eyebrow">{{ $t('search.trending') }}</p>
      <div class="card overflow-hidden">
        <TorrentTable :torrents="trendingTorrents" :compact="true" />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatAge } from '~/utils/format';
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
  // External-database ids — the grouped view buckets by tmdbId so two
  // releases of the same movie / series cluster together. The other ids
  // are kept for the chips in the row body.
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  category?: {
    id: string;
    name: string;
    slug: string;
    type: 'movie' | 'tv' | null;
  };
  tags?: TorrentTag[];
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

// `TmdbPoster` is exported by the `useTmdbPosters` composable; we
// import the type when we need to lean on it directly. The previous
// inline copy duplicated the same fields and went stale every time
// the composable shape evolved.
import type { TmdbPoster } from '~/composables/useTmdbPosters';

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

const searchQuery = ref((route.query.q as string) || '');
const selectedCategory = ref((route.query.c as string) || '');
const selectedTags = ref<string[]>(
  ((route.query.tag as string) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);
const filtersOpen = ref(selectedTags.value.length > 0);
const page = ref(parseInt((route.query.p as string) || '1', 10));
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
const view = ref<'simple' | 'grouped'>(
  (route.query.v as string) === 'grouped' ? 'grouped' : 'simple'
);
const expandedGroups = ref<Set<string>>(new Set());

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
  { value: 'simple' as const, label: t('search.viewSimple'), icon: 'ph:list-bullets-bold' },
  { value: 'grouped' as const, label: t('search.viewGrouped'), icon: 'ph:squares-four-bold' },
]);

// Fetch categories — flat list with subcategories nested.
const { data: categories } = await useFetch<Category[]>('/api/categories');
const { data: allTags } = await useFetch<TorrentTag[]>('/api/tags');

const rootCategories = computed<Category[]>(() => categories.value ?? []);

// Resolve which root is "active" for the sub-row, even when the user picked
// a sub-category directly (e.g. through a deep link). The sub-row stays
// visible while any of the parent's children is selected.
const activeRoot = computed<Category | null>(() => {
  if (!selectedCategory.value) return null;
  for (const cat of rootCategories.value) {
    if (cat.id === selectedCategory.value) return cat;
    const sub = cat.subcategories?.find(
      (s) => s.id === selectedCategory.value
    );
    if (sub) return cat;
  }
  return null;
});

const visibleSubcats = computed<Category[]>(() =>
  activeRoot.value?.subcategories ?? []
);

function hasActiveSub(cat: Category): boolean {
  return cat.subcategories?.some((s) => s.id === selectedCategory.value)
    ?? false;
}

// Fetch torrents — driven by every filter slice via a computed query.
const {
  data: torrentsData,
  pending,
} = await useFetch<{
  data: TorrentWithStats[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}>('/api/torrents', {
  query: computed(() => {
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
      page: page.value,
      // The grouped view loads a bigger window so we have something to
      // cluster — the page slicer is virtual on the FE side then.
      limit: view.value === 'grouped' ? 60 : 20,
    };
  }),
  watch: [searchQuery, selectedCategory, selectedTags, mediaIdFilter, page, view],
});

// Trending — surface 10 latest torrents when there's no query.
const { data: trendingData } = await useFetch<{ data: TorrentWithStats[] }>(
  '/api/torrents',
  { query: { limit: 10 } }
);

const torrents = computed(() => torrentsData.value?.data ?? []);
const pagination = computed(
  () => torrentsData.value?.pagination ?? { page: 1, pages: 1, total: 0 }
);
const trendingTorrents = computed(() => trendingData.value?.data ?? []);

// Total size of the current page — the table displays per-row sizes; the
// header summary helps the user gauge "is this 100 GB or 5 TB" at a
// glance, matching the upstream screenshot's "4.193 To" pill.
const totalSize = computed(() =>
  torrents.value.reduce((acc, t) => acc + (t.size || 0), 0)
);

const hasActiveQuery = computed(
  () =>
    Boolean(searchQuery.value) ||
    Boolean(selectedCategory.value) ||
    selectedTags.value.length > 0 ||
    Boolean(activeMediaId.value)
);

// ── Grouping (client-side) ───────────────────────────────────
//
// We bucket torrents by their TMDb id so every release of the same
// movie / series clusters into one card with a poster from TMDb. A
// torrent without a TMDb id has nothing to cluster against, so it gets
// its own one-element bucket and renders as a plain row (no poster,
// just the filename). The `bare` form normalises the stored id (which
// may carry a `movie/` or `tv/` prefix) so two siblings stored the
// same way still match.
function tmdbBucketKey(tmdbId: string | null | undefined): string | null {
  if (!tmdbId) return null;
  const m = tmdbId.match(/^(?:movie|tv)\/(\d+)$/);
  const bare = m ? m[1] : tmdbId;
  return `tmdb:${bare}`;
}

interface ReleaseGroup {
  key: string;
  /** Filename of the lead release — used as fallback title when no TMDb metadata. */
  fallbackTitle: string;
  /** TMDb id without `movie/` / `tv/` prefix; null for solo (un-tagged) torrents. */
  tmdbBare: string | null;
  /** TMDb namespace for the lookup endpoint. Null when we genuinely don't know. */
  tmdbType: 'movie' | 'tv' | null;
  releases: TorrentWithStats[];
  lead: TorrentWithStats;
  totalSize: number;
  totalSeeders: number;
}

const groupedResults = computed<ReleaseGroup[]>(() => {
  const buckets = new Map<string, ReleaseGroup>();
  for (const t of torrents.value) {
    const bucketKey = tmdbBucketKey(t.tmdbId) ?? `solo:${t.id}`;
    let group = buckets.get(bucketKey);
    if (!group) {
      // Pull a type hint from either the stored tmdbId prefix or the
      // category type. Both can be null; the lookup endpoint is happy
      // with null and probes movie-then-tv as a fallback.
      const prefixMatch = t.tmdbId?.match(/^(movie|tv)\//);
      const tmdbType =
        (prefixMatch?.[1] as 'movie' | 'tv' | undefined) ??
        t.category?.type ??
        null;
      group = {
        key: bucketKey,
        fallbackTitle: t.name,
        tmdbBare: bucketKey.startsWith('tmdb:') ? bucketKey.slice(5) : null,
        tmdbType,
        releases: [],
        lead: t,
        totalSize: 0,
        totalSeeders: 0,
      };
      buckets.set(bucketKey, group);
    }
    group.releases.push(t);
    group.totalSize += t.size || 0;
    group.totalSeeders += t.stats?.seeders || 0;
  }
  // Sort each group's releases by seeders desc (best release first).
  for (const g of buckets.values()) {
    g.releases.sort(
      (a, b) => (b.stats?.seeders || 0) - (a.stats?.seeders || 0)
    );
    g.lead = g.releases[0];
  }
  // Sort: TMDb-clustered groups first (newest activity first), then solo
  // torrents — that way browsing the grouped view always feels organised
  // around real titles rather than orphan releases.
  return Array.from(buckets.values()).sort((a, b) => {
    if (!!a.tmdbBare !== !!b.tmdbBare) return a.tmdbBare ? -1 : 1;
    return b.totalSeeders - a.totalSeeders;
  });
});

// ── TMDb metadata fetch (grouped view only) ────────────────
//
// All the state machinery (loading / hit / missing, sticky disabled
// flag, w500→w342 downscale) lives in `useTmdbPosters` so this page,
// /downloads, and any future surface share one cache. Local helpers
// adapt the group-shaped API to the composable's bare-id input.
const postersComposable = useTmdbPosters();

function posterFor(group: ReleaseGroup): TmdbPoster | null {
  return postersComposable.posterFor(group.tmdbBare, group.tmdbType);
}
function isPosterLoading(group: ReleaseGroup): boolean {
  return postersComposable.isPosterLoading(group.tmdbBare, group.tmdbType);
}

// Trigger fetches whenever the grouped view shows new TMDb-tagged groups.
watch(
  [groupedResults, view],
  () => {
    if (view.value !== 'grouped') return;
    for (const g of groupedResults.value) {
      postersComposable.register(g.tmdbBare, g.tmdbType);
    }
  },
  { immediate: true }
);

function toggleGroup(key: string) {
  if (expandedGroups.value.has(key)) {
    expandedGroups.value.delete(key);
  } else {
    expandedGroups.value.add(key);
  }
  // Force reactivity since Set mutations are not deeply reactive.
  expandedGroups.value = new Set(expandedGroups.value);
}

function categoryIcon(slug: string): string {
  const icons: Record<string, string> = {
    movies: 'ph:film-slate-bold',
    tv: 'ph:television-bold',
    music: 'ph:music-notes-bold',
    games: 'ph:game-controller-bold',
    software: 'ph:app-window-bold',
    ebooks: 'ph:book-open-bold',
    anime: 'ph:shooting-star-bold',
    xxx: 'ph:prohibit-bold',
    other: 'ph:package-bold',
  };
  return icons[slug] || 'ph:folder-bold';
}

function handleSearch() {
  page.value = 1;
  updateUrl();
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

function updateUrl() {
  const m = mediaIdFilter.value;
  router.replace({
    query: {
      q: searchQuery.value || undefined,
      c: selectedCategory.value || undefined,
      tag:
        selectedTags.value.length > 0
          ? selectedTags.value.join(',')
          : undefined,
      imdbid: m?.source === 'imdb' ? m.id : undefined,
      tmdbid: m?.source === 'tmdb' ? m.id : undefined,
      tvdbid: m?.source === 'tvdb' ? m.id : undefined,
      p: page.value > 1 ? page.value : undefined,
      v: view.value === 'grouped' ? 'grouped' : undefined,
    },
  });
}

watch(view, (next) => {
  page.value = 1;
  expandedGroups.value = new Set();
  updateUrl();
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

function clearTagFilters() {
  selectedTags.value = [];
  page.value = 1;
  updateUrl();
}

function activeTagStyle(tag: { color: string }) {
  const hex = (tag.color || '').replace('#', '').toLowerCase();
  const isDefault = !/^[0-9a-f]{6}$/i.test(hex) || hex === '6b7280';
  if (isDefault) {
    return {
      backgroundColor: 'rgb(var(--fg-default) / 0.18)',
      borderColor: 'rgb(var(--fg-default))',
      color: 'rgb(var(--fg-strong))',
    };
  }
  return {
    backgroundColor: `#${hex}3d`,
    borderColor: `#${hex}`,
    color: 'rgb(var(--fg-strong))',
  };
}

watch(
  () => route.query,
  (newQuery) => {
    searchQuery.value = (newQuery.q as string) || '';
    selectedCategory.value = (newQuery.c as string) || '';
    selectedTags.value = ((newQuery.tag as string) || '')
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
    page.value = parseInt((newQuery.p as string) || '1', 10);
    view.value = (newQuery.v as string) === 'grouped' ? 'grouped' : 'simple';
  },
  { deep: true }
);

useHead({
  title: () => t('search.pageTitle'),
});
</script>

<style scoped>
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
  gap: 1.25rem;
  padding-bottom: 4rem;
}

/* ─── Hero ───────────────────────────────────────────────── */
.search-hero {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
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
  font-size: clamp(1.4rem, 3.5vw, 1.85rem);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.02em;
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
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--accent-fg));
  background: rgb(var(--accent));
  border: 1px solid rgb(var(--accent));
  border-radius: 9999px;
  text-decoration: none;
  cursor: pointer;
  transition: background 0.14s, border-color 0.14s, transform 0.14s;
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
  border-radius: 9999px;
  padding: 3px;
  background: rgb(var(--bg-surface));
}
.search-mode-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  border-radius: 9999px;
  cursor: pointer;
  transition: all 0.14s;
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

.filters-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.14s;
}
.filters-toggle:hover,
.filters-toggle--on {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-default));
  background: rgb(var(--bg-surface));
}
.filters-toggle-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.1rem;
  padding: 0 0.3rem;
  font-size: 9.5px;
  letter-spacing: 0;
  color: rgb(var(--accent-fg));
  background: rgb(var(--fg-strong));
  border-radius: 9999px;
}

/* ─── Categories ─────────────────────────────────────────── */
.cats {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.cats-eyebrow {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.cats-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
.cats-row--sub {
  padding-top: 0.35rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.cat-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.85rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-surface));
  color: rgb(var(--fg-muted));
  font-family: 'Inter', sans-serif;
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.14s;
  white-space: nowrap;
}
.cat-pill:hover {
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}
.cat-pill--on {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}
.cat-pill--on:hover {
  background: rgb(var(--fg-default));
  color: rgb(var(--accent-fg));
}
.cat-pill--sub {
  font-size: 0.74rem;
  padding: 0.32rem 0.7rem;
}

/* ─── Filters panel ──────────────────────────────────────── */
.filter-panel {
  padding: 0.85rem 1rem 1rem;
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
}
.filter-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.filter-panel-clear {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  cursor: pointer;
}
.filter-panel-clear:hover {
  color: rgb(var(--danger));
}
.filter-panel-empty {
  font-size: 12px;
  color: rgb(var(--fg-muted));
  font-style: italic;
}
.filter-panel-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

/* ─── Tag toggle (kept from previous design) ──────────── */
.tag-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}
.tag-toggle:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.tag-toggle--active {
  color: rgb(var(--fg-strong));
}

/* ─── Results header ─────────────────────────────────────── */
.results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
  padding: 0.5rem 0.25rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.results-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-muted));
  text-transform: uppercase;
}
.results-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.results-stat strong {
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.results-stat-sep {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: rgb(var(--fg-faint));
}

/* ─── Loading / empty ───────────────────────────────────── */
.results-loading,
.results-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.8rem;
  padding: 4rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-surface));
}
.results-loading svg {
  color: rgb(var(--fg-muted));
}
.results-loading p {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.results-empty-icon {
  font-size: 2.25rem;
  color: rgb(var(--fg-faint));
}
.results-empty h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.results-empty p {
  margin: 0;
  font-size: 12px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  color: rgb(var(--fg-muted));
  max-width: 36ch;
}

/* ─── Grouped view ──────────────────────────────────────── */
.grouped-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.release-group {
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  overflow: hidden;
  transition: border-color 0.14s;
}
.release-group:hover {
  border-color: rgb(var(--line-strong));
}
.release-group-head {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 1rem;
  padding: 0.85rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated) / 0.4);
  width: 100%;
  text-align: left;
  /* `<button>` reset — when the grouped head doubles as a toggle we need
     it to look like the div variant. */
  border-top: 0;
  border-left: 0;
  border-right: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  transition: background 0.14s;
}
.release-group-head:not([type='button']) {
  cursor: default;
}
button.release-group-head:hover {
  background: rgb(var(--bg-elevated) / 0.7);
}
.release-group--solo .release-group-head {
  grid-template-columns: 1fr auto;
  cursor: pointer;
}
.release-group--solo .release-group-head:hover {
  background: rgb(var(--bg-elevated) / 0.7);
}
/* When the poster is intentionally absent (no tmdbId, TMDb disabled, or
   a 404 from the lookup) collapse to two columns so we don't carry an
   empty gutter on the left. */
.release-group-head:not(:has(.release-poster)) {
  grid-template-columns: 1fr auto;
}
.release-group--open .release-group-head {
  border-bottom-color: rgb(var(--line-strong));
}

/* Poster — fixed-width thumbnail with a subtle inset shadow when the
   image lands. Skeleton/placeholder share the same footprint so the
   layout never reflows. */
.release-poster {
  margin: 0;
  width: 4.5rem;
  aspect-ratio: 2 / 3;
  border-radius: 4px;
  overflow: hidden;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  position: relative;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.release-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  animation: poster-fade 0.32s ease both;
}
@keyframes poster-fade {
  from { opacity: 0; transform: scale(1.02); }
  to   { opacity: 1; transform: scale(1); }
}
.release-poster-placeholder {
  font-size: 1.4rem;
  color: rgb(var(--fg-faint));
}
.release-poster-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgb(var(--bg-base)) 30%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-base)) 70%
  );
  background-size: 220% 100%;
  animation: poster-shimmer 1.4s ease-in-out infinite;
}
@keyframes poster-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.release-group-body {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
}
.release-group-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  flex-wrap: wrap;
}
.release-group-tmdb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: rgb(var(--fg-muted));
}
.release-group-tmdb-icon {
  color: #01b4e4;
  font-size: 10.5px;
}
.release-group-title {
  margin: 0;
  font-size: 1.05rem;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.005em;
  color: rgb(var(--fg-strong));
  word-break: break-word;
}
.release-group-year {
  color: rgb(var(--fg-muted));
  font-weight: 500;
  font-size: 0.95rem;
  margin-left: 0.2rem;
}
.release-group-title-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.85rem;
  font-weight: 600;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
}
.release-group-title-loading {
  color: rgb(var(--fg-faint));
  font-style: italic;
  font-weight: 500;
  font-size: 0.95rem;
}
.release-group-overview {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--fg-muted));
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.release-group-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  flex-wrap: wrap;
}
.release-group-meta strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.release-group-meta-seed {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: rgb(var(--online));
}
.release-group-rating {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: #f5c518;
  font-weight: 700;
}
.release-group-chev {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
  transition: transform 0.18s ease;
  flex-shrink: 0;
}
.release-group-chev--up {
  transform: rotate(-180deg);
  color: rgb(var(--fg-strong));
}

.release-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.release-row {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.85rem;
  align-items: center;
  padding: 0.65rem 1rem;
  border-bottom: 1px solid rgb(var(--line-default) / 0.6);
  cursor: pointer;
  transition: background 0.12s;
}
.release-row:last-child {
  border-bottom: 0;
}
.release-row:hover {
  background: rgb(var(--fg-default) / 0.04);
}
.release-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.release-pills {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}
.release-size,
.release-age {
  white-space: nowrap;
}
.release-age {
  color: rgb(var(--fg-faint));
}

/* Accordion transition — slide releases in/out under the head. We use
   max-height so the height is animatable while the content keeps its
   intrinsic size; the bound is generous enough for 20+ releases. */
.releases-enter-active,
.releases-leave-active {
  transition: max-height 0.24s ease, opacity 0.18s ease;
  overflow: hidden;
}
.releases-enter-from,
.releases-leave-to {
  max-height: 0;
  opacity: 0;
}
.releases-enter-to,
.releases-leave-from {
  max-height: 800px;
  opacity: 1;
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
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
.results-foot-summary strong {
  color: rgb(var(--fg-strong));
}

.trending {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  margin-top: 0.5rem;
}

/* ─── media-id chip (kept from previous design) ────────── */
.media-id-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.3rem 0.5rem 0.3rem 0.65rem;
  border-radius: 9999px;
  border: 1px solid;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.06em;
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
.media-id-chip--imdb .media-id-chip-tag {
  color: #f5c518;
}
.media-id-chip--tmdb .media-id-chip-tag {
  color: #01b4e4;
}
.media-id-chip--tvdb .media-id-chip-tag {
  color: #6cd161;
}
.media-id-chip-id {
  font-family: ui-monospace, SFMono-Regular, monospace;
  text-transform: none;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
  font-weight: 600;
  font-size: 11px;
}
.media-id-chip-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.1rem;
  height: 1.1rem;
  border-radius: 9999px;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 0;
  cursor: pointer;
  transition: all 0.15s ease;
}
.media-id-chip-close:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}

/* ─── Transitions ─────────────────────────────────────── */
.subs-enter-active,
.subs-leave-active,
.panel-enter-active,
.panel-leave-active {
  transition: max-height 0.22s ease, opacity 0.18s ease, padding 0.18s ease,
    margin 0.18s ease;
  overflow: hidden;
}
.subs-enter-from,
.subs-leave-to {
  max-height: 0;
  opacity: 0;
  padding-top: 0;
  margin-top: 0;
}
.subs-enter-to,
.subs-leave-from {
  max-height: 200px;
  opacity: 1;
}
.panel-enter-from,
.panel-leave-to {
  max-height: 0;
  opacity: 0;
}
.panel-enter-to,
.panel-leave-from {
  max-height: 600px;
  opacity: 1;
}
.hint-enter-active,
.hint-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.hint-enter-from,
.hint-leave-to {
  opacity: 0;
  transform: translateY(-4px);
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
  /* Cat row scrolls horizontally on phones so chips stay readable. */
  .cats-row {
    flex-wrap: nowrap;
    overflow-x: auto;
    margin-inline: -1rem;
    padding-inline: 1rem;
    scrollbar-width: none;
  }
  .cats-row::-webkit-scrollbar {
    display: none;
  }
  .release-row {
    grid-template-columns: 1fr;
  }
  .release-pills {
    flex-wrap: wrap;
  }
  /* On phones the release-group head reflows into a tighter card with a
     smaller poster — readable but not eating half the screen. */
  .release-group-head {
    gap: 0.7rem;
    padding: 0.7rem 0.85rem;
  }
  .release-poster {
    width: 3.5rem;
  }
  .release-group-title {
    font-size: 0.95rem;
  }
  .release-group-overview {
    -webkit-line-clamp: 1;
  }
  .filters-toggle {
    margin-left: 0;
  }
}
</style>
