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
            placeholder="Search by name or infohash..."
            size="lg"
            :loading="pending"
            @search="handleSearch"
          />
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
        v-if="searchQuery || selectedCategory || selectedTags.length > 0"
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
  query: computed(() => ({
    // Coerce empty strings to undefined — the API's Zod schema requires
    // min(1) on `search` and `categoryId`, so passing the literal empty
    // string fails validation and the fetch returns 400. The /torrents
    // page already does this; we mirror it here.
    search: searchQuery.value || undefined,
    categoryId: selectedCategory.value || undefined,
    tag:
      selectedTags.value.length > 0 ? selectedTags.value.join(',') : undefined,
    page: page.value,
    limit: 20,
  })),
  watch: [searchQuery, selectedCategory, selectedTags, page],
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
  router.replace({
    query: {
      q: searchQuery.value || undefined,
      c: selectedCategory.value || undefined,
      tag:
        selectedTags.value.length > 0
          ? selectedTags.value.join(',')
          : undefined,
      p: page.value > 1 ? page.value : undefined,
    },
  });
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
</style>
