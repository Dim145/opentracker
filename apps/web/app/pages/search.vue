<template>
  <div class="flex gap-6">
    <!-- Category Sidebar -->
    <CategorySidebar
      :categories="categories ?? []"
      :selected-id="selectedCategory"
      @select="handleCategorySelect"
    />

    <!-- Main Content -->
    <div class="flex-1 min-w-0 py-8">
      <!-- Search Header -->
      <div class="mb-8 text-center lg:text-left">
        <h1
          class="text-3xl font-black text-text-primary tracking-tighter uppercase mb-4"
        >
          Search <span class="text-text-muted">Torrents</span>
        </h1>
        <div class="max-w-2xl lg:mx-0 mx-auto">
          <SearchBar
            v-model="searchQuery"
            placeholder="Search by name, hash, or paste an IMDb / TMDb / TVDB link…"
            size="lg"
            :loading="pending"
            @search="handleSearch"
            @media-id-search="handleMediaIdSearch"
          />
        </div>

        <!-- Active media-id filter — same chip pattern as /torrents,
             scaled for the larger search hero. -->
        <div
          v-if="activeMediaId"
          class="max-w-2xl lg:mx-0 mx-auto mt-3 flex items-center gap-2"
        >
          <span
            class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
          >
            Filtered by:
          </span>
          <span
            class="media-id-chip"
            :class="`media-id-chip--${activeMediaId.source}`"
          >
            <span class="media-id-chip-tag">{{ activeMediaId.label }}</span>
            <code class="media-id-chip-id">{{ activeMediaId.display }}</code>
            <button
              type="button"
              class="media-id-chip-close"
              :aria-label="`Clear ${activeMediaId.label} filter`"
              @click="clearMediaIdFilter"
            >
              <Icon name="ph:x-bold" class="text-[10px]" />
            </button>
          </span>
        </div>

        <!-- Filter panel — collapsed by default; tag toggles live here. -->
        <div class="max-w-2xl lg:mx-0 mx-auto mt-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-muted hover:text-text-strong transition-colors"
            :aria-expanded="filtersOpen"
            aria-controls="search-filter-panel"
            @click="filtersOpen = !filtersOpen"
          >
            <Icon
              :name="filtersOpen ? 'ph:funnel-fill' : 'ph:funnel'"
              :class="filtersOpen ? 'text-success' : ''"
            />
            <span :class="filtersOpen ? 'text-text-strong' : ''">
              {{ filtersOpen ? 'Hide filters' : 'Show filters' }}
            </span>
            <span
              v-if="selectedTags.length > 0"
              class="text-[10px] font-mono text-success bg-success/10 border border-success/30 rounded-full px-1.5 py-0.5 normal-case tracking-normal"
            >
              {{ selectedTags.length }}
            </span>
          </button>

          <div
            v-show="filtersOpen"
            id="search-filter-panel"
            class="mt-3 p-4 bg-bg-secondary border border-border rounded-lg text-left"
          >
            <div class="flex items-center justify-between mb-3">
              <span
                class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
              >
                Tags
              </span>
              <button
                v-if="selectedTags.length > 0"
                type="button"
                class="text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-error transition-colors"
                @click="clearTagFilters"
              >
                Clear
              </button>
            </div>
            <div
              v-if="(allTags?.length ?? 0) === 0"
              class="text-xs text-text-muted italic"
            >
              No tags yet — they'll appear here once a torrent is tagged.
            </div>
            <div v-else class="flex flex-wrap gap-2">
              <button
                v-for="tag in allTags"
                :key="tag.id"
                type="button"
                class="tag-toggle"
                :class="{
                  'tag-toggle--active': selectedTags.includes(tag.slug),
                }"
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
        </div>
      </div>

      <!-- Results Section -->
      <div
        v-if="
          searchQuery ||
          selectedCategory ||
          selectedTags.length > 0 ||
          activeMediaId
        "
        class="space-y-6"
      >
        <div class="flex items-center justify-between px-1">
          <div class="flex items-center gap-2">
            <Icon name="ph:list-bullets-bold" class="text-text-muted" />
            <h3 class="text-xs font-bold uppercase tracking-wider">
              Search Results
              <span v-if="pagination.total > 0" class="text-text-muted ml-1">
                ({{ pagination.total }})
              </span>
            </h3>
          </div>

          <!-- Sort selector: removed for now — the previous "Sort by: Newest"
               text was static and lied about being a control. Real sort UI
               is tracked for a follow-up patch. -->
        </div>

        <div class="card overflow-hidden">
          <div class="overflow-x-auto">
            <TorrentTable
              v-if="torrents.length > 0"
              :torrents="torrents"
              :compact="false"
            />
            <div v-else-if="!pending" class="p-20 text-center">
              <div
                class="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4 border border-border"
              >
                <Icon
                  name="ph:magnifying-glass-x"
                  class="text-3xl text-text-muted"
                />
              </div>
              <h3
                class="text-sm font-bold text-text-primary uppercase tracking-wider"
              >
                No results found
              </h3>
              <p
                class="text-xs text-text-muted mt-1 font-mono max-w-xs mx-auto"
              >
                We couldn't find any torrents matching your search criteria. Try
                different keywords or filters.
              </p>
            </div>
            <div v-else class="p-20 text-center">
              <Icon
                name="ph:circle-notch"
                class="animate-spin h-8 w-8 text-text-muted mx-auto mb-4"
              />
              <p
                class="text-xs text-text-muted font-mono uppercase tracking-widest"
              >
                Searching database...
              </p>
            </div>
          </div>

          <!-- Pagination -->
          <div
            v-if="pagination.pages > 1"
            class="px-4 py-3 border-t border-border flex items-center justify-between bg-bg-secondary/50"
          >
            <p
              class="text-[10px] font-mono text-text-muted uppercase tracking-widest"
            >
              Page {{ pagination.page }} / {{ pagination.pages }}
            </p>
            <div class="flex gap-1">
              <button
                class="btn btn-secondary !py-1 !px-2 text-[10px] uppercase font-bold"
                :disabled="pagination.page <= 1"
                @click="goToPage(pagination.page - 1)"
              >
                <Icon name="ph:caret-left-bold" />
              </button>
              <button
                class="btn btn-secondary !py-1 !px-2 text-[10px] uppercase font-bold"
                :disabled="pagination.page >= pagination.pages"
                @click="goToPage(pagination.page + 1)"
              >
                <Icon name="ph:caret-right-bold" />
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State / Trending -->
      <div v-else class="mt-12">
        <div class="flex items-center gap-2 mb-6 px-1">
          <Icon name="ph:trend-up-bold" class="text-text-muted" />
          <h3 class="text-xs font-bold uppercase tracking-wider">
            Trending Torrents
          </h3>
        </div>
        <div class="card overflow-hidden">
          <TorrentTable :torrents="trendingTorrents" :compact="true" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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
  category?: {
    id: string;
    name: string;
    slug: string;
  };
  tags?: TorrentTag[];
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

const route = useRoute();
const router = useRouter();

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

// Fetch categories
const { data: categories } = await useFetch<any[]>('/api/categories');
const { data: allTags } = await useFetch<TorrentTag[]>('/api/tags');

// Fetch torrents
const {
  data: torrentsData,
  pending,
  refresh,
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
      limit: 20,
    };
  }),
  watch: [searchQuery, selectedCategory, selectedTags, mediaIdFilter, page],
});

// Fetch trending (just recent for now)
const { data: trendingData } = await useFetch<{ data: TorrentWithStats[] }>(
  '/api/torrents',
  {
    query: { limit: 10 },
  }
);

const torrents = computed(() => torrentsData.value?.data ?? []);
const pagination = computed(
  () => torrentsData.value?.pagination ?? { page: 1, pages: 1, total: 0 }
);
const trendingTorrents = computed(() => trendingData.value?.data ?? []);

const searchBarRef = ref(null);

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
  window.scrollTo({ top: 0, behavior: 'smooth' });
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
    },
  });
}

function handleMediaIdSearch(detected: DetectedMediaId) {
  // A media-id submission supersedes the text search.
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
  // Same logic as the torrents page — see comment there.
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

// Sync with URL on load and back/forward
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
  },
  { deep: true }
);

useHead({
  title: 'Search Torrents',
});
</script>

<style scoped>
.tag-toggle {
  @apply inline-flex items-center gap-1.5 px-3 py-1 rounded-full
         border border-border bg-bg-tertiary
         text-[11px] font-medium text-text-secondary
         hover:text-text-primary hover:bg-fg-default/5
         hover:border-fg-default/30
         transition-colors;
}
.tag-toggle--active {
  @apply text-text-primary;
}

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
  transition: all 0.15s ease;
}
.media-id-chip-close:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.1);
}
</style>
