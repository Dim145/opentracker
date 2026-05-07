<template>
  <div class="flex gap-6">
    <!-- Category Sidebar -->
    <CategorySidebar
      :categories="categories ?? []"
      :selected-id="selectedCategory"
      @select="handleCategorySelect"
    />

    <!-- Main Content -->
    <div class="flex-1 min-w-0">
      <!-- Page Header -->
      <div
        class="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4"
      >
        <div>
          <h2
            class="text-xl font-bold text-text-primary tracking-tight uppercase"
          >
            Torrent Index
          </h2>
          <p class="text-xs text-text-muted font-mono mt-0.5">
            {{ pagination.total }} objects indexed in database
          </p>
        </div>

        <!-- Actions -->
        <div class="flex flex-wrap items-start gap-2">
          <SearchBar
            v-model="search"
            placeholder="Search by name, hash, or paste an IMDb / TMDb / TVDB link…"
            class="w-full md:w-80"
            :loading="pending"
            @search="doSearch"
            @media-id-search="doMediaIdSearch"
          />
          <button
            class="btn btn-primary flex items-center gap-2 !py-1.5"
            @click="showUploadModal = true"
          >
            <Icon name="ph:plus-bold" />
            <span>Upload</span>
          </button>
        </div>
      </div>

      <!-- Active media-id filter chip — sits between the search bar
           and the filter panel so it's the first thing the user sees
           when their listing is narrowed by an external id. -->
      <div
        v-if="activeMediaId"
        class="mb-4 flex items-center gap-2"
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

      <!-- Filter panel — collapsed by default, opens to expose tag toggles -->
      <div class="mb-4">
        <button
          type="button"
          class="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-text-muted hover:text-text-strong transition-colors"
          :aria-expanded="filtersOpen"
          aria-controls="torrents-filter-panel"
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
          id="torrents-filter-panel"
          class="mt-3 p-4 bg-bg-secondary border border-border rounded-lg"
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

      <!-- Torrents Table -->
      <div class="card overflow-hidden">
        <div class="overflow-x-auto">
          <TorrentTable
            v-if="torrents.length > 0"
            :torrents="torrents"
            admin
            @deleted="() => refresh()"
          />
          <div v-else class="p-16 text-center">
            <div
              class="w-16 h-16 bg-bg-tertiary rounded-full flex items-center justify-center mx-auto mb-4 border border-border"
            >
              <Icon name="ph:magnifying-glass" class="text-3xl text-text-muted" />
            </div>
            <h3
              class="text-sm font-bold text-text-primary uppercase tracking-wider"
            >
              No results found
            </h3>
            <p class="text-xs text-text-muted mt-1 font-mono">
              The search query did not match any indexed torrents.
            </p>
            <button
              v-if="search || selectedCategory"
              class="btn btn-secondary mt-6 text-xs uppercase tracking-widest font-bold"
              @click="clearFilters"
            >
              Reset Filters
            </button>
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

    <!-- Upload Modal -->
    <UploadTorrentModal
      :is-open="showUploadModal"
      @close="showUploadModal = false"
      @uploaded="onUploaded"
    />
  </div>
</template>

<script setup lang="ts">
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
  tags?: Array<{ id: string; name: string; slug: string; color: string }>;
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const route = useRoute();
const router = useRouter();

const search = ref((route.query.search as string) || '');
const page = ref(parseInt((route.query.page as string) || '1', 10));
const selectedCategory = ref((route.query.categoryId as string) || '');
const selectedTags = ref<string[]>(
  ((route.query.tag as string) || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

// External media-id filter. Backed by URL query params so the filter
// survives reloads and can be shared as a deep link. Read on mount
// from any of `?imdbid=`, `?tmdbid=`, `?tvdbid=`.
const mediaIdFilter = ref<{ source: 'imdb' | 'tmdb' | 'tvdb'; id: string } | null>(
  (() => {
    const q = route.query;
    if (q.imdbid) return { source: 'imdb', id: String(q.imdbid) };
    if (q.tmdbid) return { source: 'tmdb', id: String(q.tmdbid) };
    if (q.tvdbid) return { source: 'tvdb', id: String(q.tvdbid) };
    return null;
  })()
);

import {
  detectMediaId,
  type DetectedMediaId,
} from '~/utils/mediaIdDetect';

const activeMediaId = computed<DetectedMediaId | null>(() => {
  const m = mediaIdFilter.value;
  if (!m) return null;
  // Re-detect to recover a clean display label/icon — the URL value
  // can be any of the canonical forms we emit (`tt12345`, `tv/121361`,
  // bare digits, …) so we feed it back through the detector.
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

const showUploadModal = ref(false);
// Filter panel starts open if a tag filter is already in the URL —
// otherwise the user wouldn't see why their listing is filtered.
const filtersOpen = ref(selectedTags.value.length > 0);

const { data: categories } = await useFetch('/api/categories');
const { data: allTags } = await useFetch<
  Array<{ id: string; name: string; slug: string; color: string }>
>('/api/tags');

const { data, refresh, pending } = await useFetch<{
  data: TorrentWithStats[];
  pagination: Pagination;
}>('/api/torrents', {
  query: computed(() => {
    const m = mediaIdFilter.value;
    return {
      page: page.value,
      limit: 25,
      search: search.value || undefined,
      categoryId: selectedCategory.value || undefined,
      tag: selectedTags.value.length > 0
        ? selectedTags.value.join(',')
        : undefined,
      // Only one media-id filter is active at a time; passing only
      // the matching key keeps the request short and the schema happy.
      imdbid: m?.source === 'imdb' ? m.id : undefined,
      tmdbid: m?.source === 'tmdb' ? m.id : undefined,
      tvdbid: m?.source === 'tvdb' ? m.id : undefined,
    };
  }),
});

function onUploaded() {
  refresh();
}

const torrents = computed(() => data.value?.data ?? []);
const pagination = computed(
  () => data.value?.pagination ?? { page: 1, limit: 25, total: 0, pages: 0 }
);

function buildQuery(extra: Record<string, string | undefined> = {}) {
  const m = mediaIdFilter.value;
  return {
    search: search.value || undefined,
    categoryId: selectedCategory.value || undefined,
    tag:
      selectedTags.value.length > 0
        ? selectedTags.value.join(',')
        : undefined,
    imdbid: m?.source === 'imdb' ? m.id : undefined,
    tmdbid: m?.source === 'tmdb' ? m.id : undefined,
    tvdbid: m?.source === 'tvdb' ? m.id : undefined,
    page: undefined,
    ...extra,
  };
}

function doSearch() {
  page.value = 1;
  router.push({ query: buildQuery() });
  refresh();
}

function doMediaIdSearch(detected: DetectedMediaId) {
  // A media-id submission supersedes the text search — running both
  // would be confusing and the API treats them as independent narrows
  // anyway. Clear the text input + adopt the detected id as the
  // sole filter.
  search.value = '';
  mediaIdFilter.value = { source: detected.source, id: detected.id };
  page.value = 1;
  router.push({ query: buildQuery() });
  refresh();
}

function clearMediaIdFilter() {
  mediaIdFilter.value = null;
  page.value = 1;
  router.push({ query: buildQuery() });
  refresh();
}

function handleCategorySelect(id: string) {
  selectedCategory.value = id;
  doSearch();
}

function clearFilters() {
  search.value = '';
  selectedCategory.value = '';
  selectedTags.value = [];
  mediaIdFilter.value = null;
  doSearch();
}

function toggleTag(slug: string) {
  if (selectedTags.value.includes(slug)) {
    selectedTags.value = selectedTags.value.filter((t) => t !== slug);
  } else {
    selectedTags.value = [...selectedTags.value, slug];
  }
  doSearch();
}

function clearTagFilters() {
  selectedTags.value = [];
  doSearch();
}

function activeTagStyle(tag: { color: string }) {
  // Active tag chips use a tint of the tag's own color, but the default
  // tag color (#6b7280 / grey-500) is too neutral to "pop" off the
  // panel — fall back to the accent palette in that case so the active
  // state always feels obviously selected. Otherwise tint at ~25% bg /
  // 100% border to read well on either theme.
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

function goToPage(p: number) {
  page.value = p;
  router.push({ query: { ...route.query, page: p > 1 ? p : undefined } });
  refresh();
}
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
  /* active background/border come from the inline tint in activeTagStyle —
     this class only handles the default-state override. */
}

/* Active media-id filter chip — same brand-colour palette as the
   detail-page badges, with a close button. */
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
