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
        :loading="isLoading"
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
<!-- Size is a flat-view fact; see `totalSize`. -->
        <template v-if="totalSize > 0">
          <span class="results-stat">
            <Icon name="ph:hard-drive-bold" />
            <strong>{{ formatSize(totalSize) }}</strong>
          </span>
          <span class="results-stat-sep" />
        </template>
        <span class="results-stat">
          <strong>{{ pagination.total }}</strong>
          {{
            view === 'grouped'
              ? $t('search.group.workCount', pagination.total)
              : $t('search.torrentCount', pagination.total)
          }}
        </span>

        <!-- Only on an instance that actually has partners. On a lone one the
             two options would give identical results, and a control that never
             changes anything is worse than no control. -->
        <template v-if="view === 'grouped' && (federated || sources === 'local')">
          <span class="results-stat-sep" />
          <div class="src-toggle" :title="$t('search.group.sourcesHint')">
            <button
              type="button"
              :class="{ 'src-on': sources === 'all' }"
              @click="sources = 'all'"
            >
              <Icon name="ph:broadcast-bold" />
              {{ $t('search.group.sourcesAll') }}
            </button>
            <button
              type="button"
              :class="{ 'src-on': sources === 'local' }"
              @click="sources = 'local'"
            >
              <Icon name="ph:house-bold" />
              {{ $t('search.group.sourcesLocal') }}
            </button>
          </div>
        </template>
      </div>
      <Pager
        v-if="pagination.pages > 1"
        :page="pagination.page"
        :pages="pagination.pages"
        @go="goToPage"
      />
    </div>

    <!-- ── Pinned ────────────────────────────────────────────────
         Above the results and visually apart, because a pin answers a
         different question than the listing does: not "what matches" but
         "read this one". Rendered with the same table so the columns line up
         with the flow underneath — a pin changes the position of a release,
         never how it is read. -->
    <section v-if="pinnedTorrents.length > 0" class="pinned-block">
      <header class="pinned-head">
        <Icon name="ph:push-pin-fill" class="pinned-icon" />
        <h2 class="pinned-title">{{ $t('search.pinned.title') }}</h2>
        <span class="pinned-rule" />
      </header>
      <div class="card overflow-hidden">
        <div class="overflow-x-auto">
          <TorrentTable :torrents="pinnedTorrents" :compact="true" />
        </div>
      </div>
    </section>

    <!-- ── Results body ──────────────────────────────────────── -->
    <section v-if="hasActiveQuery">
      <div v-if="isLoading" class="results-loading">
        <Icon name="ph:circle-notch" class="animate-spin h-8 w-8" />
        <p>{{ $t('search.searchingDatabase') }}</p>
      </div>
      <div v-else-if="resultCount === 0" class="results-empty">
        <Icon name="ph:magnifying-glass-x" class="results-empty-icon" />
        <h3>{{ $t('search.noResults') }}</h3>
        <p>{{ $t('search.noResultsHint') }}</p>
      </div>
      <template v-else>
        <!-- Simple: classic table -->
        <div v-if="view === 'simple'" class="card overflow-hidden">
          <div class="overflow-x-auto">
            <TorrentTable
              :torrents="torrents"
              :compact="false"
              :sort-by="sortBy"
              :order="sortOrder"
              @sort="applySort"
            />
          </div>
        </div>
        <!-- Grouped: one row per work, collapsed.

             The row states what the work is and HOW IT HAS BEEN CUT — per
             episode, as season packs, as an integral — and each of those is a
             way in as well as a label. Opening a row is for choosing a file;
             finding out what exists happens without opening anything. -->
        <div v-else class="card overflow-hidden">
          <div class="overflow-x-auto">
            <TorrentGroupTable
              :groups="servedGroups"
              :category-label="categoryLabel"
              :sort-by="sortBy"
              :order="sortOrder"
              @sort="applySort"
            />
          </div>
        </div>
      </template>

      <!-- Bottom pagination -->
      <div v-if="pagination.pages > 1 && resultCount > 0" class="results-foot">
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
        <TorrentTable
          :torrents="trendingTorrents"
          :compact="true"
          :sort-by="sortBy"
          :order="sortOrder"
          @sort="applySort"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatAge } from '~/utils/format';
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

/**
 * Sort, in the URL so a sorted listing can be linked, bookmarked and walked
 * back through with the browser's own history — the same contract the search,
 * category and tag filters already have.
 *
 * The server does the ordering: sorting a page of 20 client-side would order
 * twenty rows out of twelve thousand, which reads as a broken feature the
 * moment a member pages forward.
 */
const sortBy = ref<TorrentSortKey>(
  (TORRENT_SORT_KEYS as readonly string[]).includes(route.query.s as string)
    ? (route.query.s as TorrentSortKey)
    : 'age'
);
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
const view = ref<'simple' | 'grouped'>(
  (route.query.v as string) === 'grouped' ? 'grouped' : 'simple'
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
      limit: 20,
      sortBy: sortBy.value,
      order: sortOrder.value,
    };
  }),
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
const branding = await useBranding();
const federated = computed(() => Boolean(branding.value?.federationEnabled));

// Fetch groups — the grouped view's own endpoint. It folds the WHOLE catalogue,
// not the page the flat listing happened to return, so its counts, episode sets
// and pagination describe the catalogue rather than the window.
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
  query: computed(() => ({
    search: searchQuery.value || undefined,
    categoryId: selectedCategory.value || undefined,
    sources: sources.value,
    page: page.value,
    limit: 25,
    // Same keys as the flat listing: switching views keeps the order, even
    // though what each key means across a group is decided server-side.
    sortBy: sortBy.value,
    order: sortOrder.value,
  })),
  watch: false,
  immediate: view.value === 'grouped',
});


// One watcher for both endpoints: whichever view is on screen is the one that
// refetches. Switching views is itself a trigger, so the first switch loads the
// side that was skipped at mount.
watch(
  [
    searchQuery,
    selectedCategory,
    selectedTags,
    mediaIdFilter,
    page,
    view,
    sources,
    sortBy,
    sortOrder,
  ],
  () => {
    if (view.value === 'grouped') refreshGroups();
    else refreshTorrents();
  }
);

// Trending — surface 10 latest torrents when there's no query.
const { data: trendingData } = await useFetch<{ data: TorrentWithStats[] }>(
  '/api/torrents',
  { query: { limit: 10 } }
);

const torrents = computed(() => torrentsData.value?.data ?? []);
const pinnedTorrents = computed(() => torrentsData.value?.pinned ?? []);
const trendingTorrents = computed(() => trendingData.value?.data ?? []);

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
    Boolean(activeMediaId.value) ||
    // Sorting is a query too. Clicking "size" on the landing view means "show
    // me the biggest releases", which is a question about the catalogue — not
    // about the ten rows the trending teaser happens to be showing.
    isSorted.value
);

/** True once the user has moved off the default ordering. */
const isSorted = computed(
  () => sortBy.value !== 'age' || sortOrder.value !== 'desc'
);

/**
 * The groups as served. No adaptation layer: the row component consumes the
 * API's shape directly, because there is no longer a client-side grouping for
 * it to be reconciled with.
 */
const servedGroups = computed(() => groupsData.value?.groups ?? []);

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
      // Omitted while on the default so a plain listing keeps a clean URL.
      s: sortBy.value !== 'age' ? sortBy.value : undefined,
      d: sortOrder.value !== 'desc' ? sortOrder.value : undefined,
    },
  });
}

watch(view, (next) => {
  page.value = 1;
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

.filters-toggle {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.35rem 0.65rem;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all var(--dur-2);
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
  font-size: 0.5938rem;
  letter-spacing: 0;
  color: rgb(var(--accent-fg));
  background: rgb(var(--fg-strong));
  border-radius: var(--radius-pill);
}

/* ─── Categories ─────────────────────────────────────────── */
.cats {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}
.cats-eyebrow {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  font-weight: 700;
  letter-spacing: calc(0.22em * var(--tracking-scale));
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
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-surface));
  color: rgb(var(--fg-muted));
  font-family: var(--font-sans);
  font-size: 0.78rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur-2);
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
  border-radius: var(--radius-sm);
}
.filter-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 0.5rem;
}
.filter-panel-clear {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  font-weight: 700;
  letter-spacing: calc(0.16em * var(--tracking-scale));
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
  font-size: 0.75rem;
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
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 0.6875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all var(--dur-1);
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
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: calc(0.06em * var(--tracking-scale));
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
  border-radius: var(--radius-pill);
  background: rgb(var(--fg-faint));
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

/* ─── Loading / empty ───────────────────────────────────── */
/* ── Pinned block ────────────────────────────────────────────────
   Set apart from the flow by a rule and an icon rather than by a tint: the
   rows inside are ordinary rows and should read as such. */
.pinned-block {
  margin-bottom: 1.75rem;
}
.pinned-head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.6rem;
}
.pinned-icon {
  width: 1rem;
  height: 1rem;
  color: rgb(var(--accent));
}
.pinned-title {
  margin: 0;
  font-size: 0.72rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.pinned-rule {
  flex: 1;
  height: 1px;
  background: rgb(var(--line-default));
}

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
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-surface));
}
.results-loading svg {
  color: rgb(var(--fg-muted));
}
.results-loading p {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.results-empty-icon {
  font-size: 2.25rem;
  color: rgb(var(--fg-faint));
}
.results-empty h3 {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  letter-spacing: calc(0.04em * var(--tracking-scale));
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.results-empty p {
  margin: 0;
  font-size: 0.75rem;
  font-family: var(--font-mono);
  color: rgb(var(--fg-muted));
  max-width: 36ch;
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

/* ─── Transitions ─────────────────────────────────────── */
.subs-enter-active,
.subs-leave-active,
.panel-enter-active,
.panel-leave-active {
  transition: max-height var(--dur-4) ease, opacity var(--dur-3) ease, padding var(--dur-3) ease,
    margin var(--dur-3) ease;
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
  transition: opacity var(--dur-3) ease, transform var(--dur-3) ease;
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
  .filters-toggle {
    margin-left: 0;
  }
}

</style>
