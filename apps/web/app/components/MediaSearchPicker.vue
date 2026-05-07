<template>
  <div class="picker">
    <!-- Search input + results -->
    <div class="picker-search">
      <div class="picker-search-input-wrap">
        <Icon name="ph:magnifying-glass-bold" class="picker-search-icon" />
        <input
          v-model="rawQuery"
          type="text"
          class="input picker-search-input"
          :placeholder="
            typeHint === 'tv'
              ? 'Search TV shows on TMDb…'
              : typeHint === 'movie'
                ? 'Search movies on TMDb…'
                : 'Search TMDb (movies + TV)…'
          "
          @focus="open = true"
          @keydown.escape="open = false"
          @keydown.down.prevent="moveFocus(1)"
          @keydown.up.prevent="moveFocus(-1)"
          @keydown.enter.prevent="confirmFocus"
        />
        <button
          v-if="rawQuery"
          type="button"
          class="picker-search-clear"
          @click="clearQuery"
        >
          <Icon name="ph:x-bold" />
        </button>
        <span v-if="loading" class="picker-search-spin">
          <Icon name="ph:circle-notch" class="animate-spin" />
        </span>
      </div>

      <Transition name="picker-fade">
        <div
          v-if="open && (results.length > 0 || error || (debouncedQuery && !loading))"
          class="picker-results"
          @mousedown.prevent
        >
          <p v-if="error" class="picker-error">{{ error }}</p>
          <p
            v-else-if="debouncedQuery && !loading && results.length === 0"
            class="picker-empty"
          >
            No matches for <em>{{ debouncedQuery }}</em>
          </p>
          <ul v-else class="picker-list">
            <li
              v-for="(hit, i) in results"
              :key="`${hit.type}-${hit.tmdbId}`"
              class="picker-item"
              :class="{ 'picker-item--focused': focusIndex === i }"
              @mouseenter="focusIndex = i"
              @click="selectHit(hit)"
            >
              <div class="picker-poster">
                <img
                  v-if="hit.posterUrl"
                  :src="hit.posterUrl"
                  :alt="hit.title"
                  loading="lazy"
                />
                <Icon v-else name="ph:image-square" />
              </div>
              <div class="picker-info">
                <p class="picker-title">
                  <span>{{ hit.title }}</span>
                  <span v-if="hit.year" class="picker-year">({{ hit.year }})</span>
                </p>
                <p class="picker-meta">
                  <span class="picker-kind" :class="`picker-kind--${hit.type}`">
                    <Icon
                      :name="
                        hit.type === 'movie'
                          ? 'ph:film-strip-bold'
                          : 'ph:television-simple-bold'
                      "
                    />
                    {{ hit.type === 'movie' ? 'Movie' : 'TV' }}
                  </span>
                  <span v-if="hit.voteAverage" class="picker-rating">
                    <Icon name="ph:star-fill" />
                    {{ hit.voteAverage.toFixed(1) }}
                  </span>
                </p>
                <p v-if="hit.overview" class="picker-overview">
                  {{ hit.overview }}
                </p>
              </div>
            </li>
          </ul>
          <p v-if="results.length > 0" class="picker-hint">
            <kbd>↑</kbd><kbd>↓</kbd> to browse · <kbd>Enter</kbd> to pick
          </p>
        </div>
      </Transition>
    </div>

    <!-- Selected chip -->
    <div v-if="selected" class="picker-selected">
      <div class="picker-poster picker-poster--lg">
        <img
          v-if="selected.posterUrl"
          :src="selected.posterUrl"
          :alt="selected.title"
        />
        <Icon v-else name="ph:image-square" />
      </div>
      <div class="picker-selected-body">
        <p class="picker-selected-title">
          {{ selected.title }}
          <span v-if="selected.year" class="picker-year"
            >({{ selected.year }})</span
          >
        </p>
        <div class="picker-selected-ids">
          <span class="id-tag id-tag--tmdb"
            >TMDb {{ selected.tmdbId }}</span
          >
          <span v-if="selected.imdbId" class="id-tag id-tag--imdb">{{
            selected.imdbId
          }}</span>
          <span v-if="selected.tvdbId" class="id-tag id-tag--tvdb"
            >TVDB {{ selected.tvdbId }}</span
          >
        </div>
      </div>
      <button type="button" class="picker-clear" @click="clearSelection">
        <Icon name="ph:x-bold" />
        <span>Clear</span>
      </button>
    </div>

    <!-- Manual ID fallback -->
    <details class="picker-manual">
      <summary>
        <Icon name="ph:identification-card-bold" />
        Or paste an ID manually
      </summary>
      <div class="id-grid">
        <label>
          <span class="id-tag id-tag--imdb">IMDb</span>
          <input
            :value="imdbId"
            type="text"
            class="input id-input"
            placeholder="tt1234567"
            @input="$emit('update:imdbId', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          <span class="id-tag id-tag--tmdb">TMDb</span>
          <input
            :value="tmdbId"
            type="text"
            class="input id-input"
            placeholder="12345 or tv/12345"
            @input="$emit('update:tmdbId', ($event.target as HTMLInputElement).value)"
          />
        </label>
        <label>
          <span class="id-tag id-tag--tvdb">TVDB</span>
          <input
            :value="tvdbId"
            type="text"
            class="input id-input"
            placeholder="78804"
            @input="$emit('update:tvdbId', ($event.target as HTMLInputElement).value)"
          />
        </label>
      </div>
      <button
        type="button"
        class="btn-ghost btn-ghost--small"
        :disabled="!hasAnyManualId || resolving"
        @click="resolveManual"
      >
        <Icon
          :name="resolving ? 'ph:circle-notch' : 'ph:magic-wand-bold'"
          :class="{ 'animate-spin': resolving }"
        />
        {{ resolving ? 'Resolving…' : 'Resolve & preview' }}
      </button>
    </details>
  </div>
</template>

<script setup lang="ts">
interface MediaSearchHit {
  type: 'movie' | 'tv';
  tmdbId: number;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  url: string;
}

/** Full normalised metadata returned by /api/metadata/lookup. */
interface MediaMetadata {
  source: 'tmdb';
  type: 'movie' | 'tv';
  tmdbId: number;
  imdbId: string | null;
  tvdbId: number | null;
  title: string;
  year: number | null;
  posterUrl: string | null;
  [key: string]: unknown;
}

const props = defineProps<{
  initialQuery?: string;
  initialYear?: number | null;
  /** 'movie' | 'tv' from the category. Constrains the search. */
  typeHint?: 'movie' | 'tv';
  /** Auto-fire a search for `initialQuery` when it lands non-empty. */
  autoSearch?: boolean;
  /** Currently-resolved metadata (so the chip survives parent re-renders). */
  selected?: MediaMetadata | null;
  /** Manual fallback bindings — wired straight to parent state. */
  imdbId?: string;
  tmdbId?: string;
  tvdbId?: string;
}>();

const emit = defineEmits<{
  /** User picked a result — full normalised metadata from /lookup. */
  (e: 'select', metadata: MediaMetadata): void;
  /** User cleared the selection (or the parent should reset state). */
  (e: 'clear'): void;
  /** Manual ID input bridge. */
  (e: 'update:imdbId', value: string): void;
  (e: 'update:tmdbId', value: string): void;
  (e: 'update:tvdbId', value: string): void;
}>();

const rawQuery = ref(props.initialQuery ?? '');
const debouncedQuery = ref('');
const open = ref(false);
const loading = ref(false);
const resolving = ref(false);
const error = ref<string | null>(null);
const results = ref<MediaSearchHit[]>([]);
const focusIndex = ref(-1);

watch(
  () => props.initialQuery,
  (q) => {
    if (q && q !== rawQuery.value) {
      rawQuery.value = q;
      // Re-fire when the parent updates (new file dropped → new title)
      if (props.autoSearch) open.value = true;
    }
  }
);

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
watch(rawQuery, (val) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!val.trim()) {
    debouncedQuery.value = '';
    results.value = [];
    error.value = null;
    return;
  }
  debounceTimer = setTimeout(() => {
    debouncedQuery.value = val.trim();
  }, 300);
});

watch(debouncedQuery, async (q) => {
  if (!q) return;
  loading.value = true;
  error.value = null;
  try {
    const params: Record<string, string | number> = { query: q };
    if (props.typeHint) params.type = props.typeHint;
    if (props.initialYear) params.year = props.initialYear;
    const res = await $fetch<{
      enabled: boolean;
      message?: string;
      results: MediaSearchHit[];
    }>('/api/metadata/search', { query: params });
    if (!res.enabled) {
      error.value = res.message || 'Metadata search is not configured.';
      results.value = [];
    } else {
      results.value = res.results;
      focusIndex.value = res.results.length > 0 ? 0 : -1;
    }
  } catch (err: any) {
    error.value =
      err?.data?.message || err?.message || 'Search failed';
    results.value = [];
  } finally {
    loading.value = false;
  }
});

// Auto-fire once when mounted with an initial query
onMounted(() => {
  if (props.autoSearch && (props.initialQuery ?? '').trim()) {
    debouncedQuery.value = (props.initialQuery ?? '').trim();
    open.value = true;
  }
});

// Click outside → close the dropdown so it doesn't sit on top of the
// rest of the form forever.
const root = ref<HTMLElement | null>(null);
function onDocClick(e: MouseEvent) {
  if (!root.value) return;
  if (!(e.target instanceof Node)) return;
  if (!root.value.contains(e.target)) open.value = false;
}
onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));

function moveFocus(delta: number) {
  if (results.value.length === 0) return;
  open.value = true;
  const next = focusIndex.value + delta;
  if (next < 0) focusIndex.value = results.value.length - 1;
  else if (next >= results.value.length) focusIndex.value = 0;
  else focusIndex.value = next;
}

function confirmFocus() {
  if (focusIndex.value >= 0 && results.value[focusIndex.value]) {
    selectHit(results.value[focusIndex.value]!);
  }
}

async function selectHit(hit: MediaSearchHit) {
  open.value = false;
  rawQuery.value = '';
  // Pull the full record (with cross-database ids) so the parent gets
  // imdbId + tvdbId in one go.
  resolving.value = true;
  error.value = null;
  try {
    const res = await $fetch<{
      enabled: boolean;
      found: boolean;
      metadata: MediaMetadata | null;
    }>('/api/metadata/lookup', {
      query: { source: 'tmdb', id: `${hit.type}/${hit.tmdbId}` },
    });
    if (res.enabled && res.found && res.metadata) {
      emit('select', res.metadata);
    } else {
      error.value = 'Could not load full details for that result.';
    }
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'Lookup failed';
  } finally {
    resolving.value = false;
  }
}

function clearQuery() {
  rawQuery.value = '';
  debouncedQuery.value = '';
  results.value = [];
}

function clearSelection() {
  emit('clear');
}

const hasAnyManualId = computed(
  () =>
    !!(
      (props.imdbId ?? '').trim() ||
      (props.tmdbId ?? '').trim() ||
      (props.tvdbId ?? '').trim()
    )
);

async function resolveManual() {
  const params: Record<string, string> | null = (props.tmdbId ?? '').trim()
    ? { source: 'tmdb', id: (props.tmdbId ?? '').trim() }
    : (props.imdbId ?? '').trim()
      ? { source: 'imdb', id: (props.imdbId ?? '').trim() }
      : (props.tvdbId ?? '').trim()
        ? { source: 'tvdb', id: (props.tvdbId ?? '').trim() }
        : null;
  if (!params) return;
  if (props.typeHint) (params as Record<string, string>).type = props.typeHint;
  resolving.value = true;
  error.value = null;
  try {
    const res = await $fetch<{
      enabled: boolean;
      found: boolean;
      metadata: MediaMetadata | null;
    }>('/api/metadata/lookup', { query: params });
    if (!res.enabled) {
      error.value = 'Metadata lookup is not configured.';
    } else if (!res.found) {
      error.value = `No match for ${params.source.toUpperCase()} ${params.id}`;
    } else if (res.metadata) {
      emit('select', res.metadata);
    }
  } catch (err: any) {
    error.value = err?.data?.message || err?.message || 'Lookup failed';
  } finally {
    resolving.value = false;
  }
}
</script>

<style scoped>
.picker {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

/* ─── Search input ─────────────────────────────────────────── */
.picker-search {
  position: relative;
}
.picker-search-input-wrap {
  position: relative;
  display: flex;
  align-items: center;
}
.picker-search-icon {
  position: absolute;
  left: 0.85rem;
  font-size: 1.05rem;
  color: rgb(var(--fg-muted));
  pointer-events: none;
}
.picker-search-input {
  width: 100%;
  padding-left: 2.5rem;
  padding-right: 2.5rem;
  font-size: 0.875rem;
}
.picker-search-clear,
.picker-search-spin {
  position: absolute;
  right: 0.6rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.picker-search-clear {
  width: 1.4rem;
  height: 1.4rem;
  border-radius: 9999px;
  transition: all 0.15s;
}
.picker-search-clear:hover {
  color: rgb(var(--fg-strong));
  background: rgb(var(--bg-elevated));
}

/* ─── Results dropdown ─────────────────────────────────────── */
.picker-results {
  position: absolute;
  top: calc(100% + 0.4rem);
  left: 0;
  right: 0;
  z-index: 20;
  max-height: 28rem;
  overflow-y: auto;
  padding: 0.5rem;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  box-shadow:
    0 1px 2px rgb(0 0 0 / 0.06),
    0 12px 32px -8px rgb(0 0 0 / 0.18);
}
.picker-error {
  padding: 0.85rem;
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--danger));
}
.picker-empty {
  padding: 1rem;
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--fg-muted));
  text-align: center;
}
.picker-empty em {
  font-style: italic;
  color: rgb(var(--fg-default));
}
.picker-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}
.picker-item {
  display: flex;
  gap: 0.85rem;
  padding: 0.6rem;
  border-radius: 0.4rem;
  cursor: pointer;
  transition: background 0.12s;
}
.picker-item--focused,
.picker-item:hover {
  background: rgb(var(--bg-elevated));
}
.picker-poster {
  flex-shrink: 0;
  width: 3rem;
  aspect-ratio: 2 / 3;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgb(var(--fg-muted));
  font-size: 1.25rem;
}
.picker-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.picker-info {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  flex: 1;
}
.picker-title {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  display: flex;
  align-items: baseline;
  gap: 0.4rem;
  flex-wrap: wrap;
}
.picker-year {
  font-size: 0.75rem;
  font-weight: 500;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.picker-meta {
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 11px;
  color: rgb(var(--fg-muted));
}
.picker-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.45rem;
  border-radius: 9999px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}
.picker-kind--movie {
  border-color: rgba(245, 197, 24, 0.45);
  color: #f5c518;
  background: rgba(245, 197, 24, 0.08);
}
.picker-kind--tv {
  border-color: rgba(108, 209, 97, 0.45);
  color: #6cd161;
  background: rgba(108, 209, 97, 0.08);
}
.picker-rating {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  color: #f5c518;
  font-weight: 600;
}
.picker-overview {
  margin: 0.15rem 0 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.picker-hint {
  margin: 0.5rem 0 0;
  padding: 0.5rem;
  font-size: 11px;
  color: rgb(var(--fg-muted));
  text-align: right;
  border-top: 1px solid rgb(var(--line-default));
}
.picker-hint kbd {
  display: inline-block;
  padding: 0.05rem 0.35rem;
  margin-right: 0.15rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.2rem;
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
}

/* ─── Selected chip ────────────────────────────────────────── */
.picker-selected {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid #6cd161;
  border-radius: 0.4rem;
}
.picker-poster--lg {
  width: 3.5rem;
}
.picker-selected-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.picker-selected-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.picker-selected-ids {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 0.4rem;
}
.picker-selected-ids .id-tag {
  font-size: 9px;
  letter-spacing: 0.12em;
  padding: 0.15rem 0.55rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  font-weight: 700;
}
.picker-selected-ids .id-tag--imdb { color: #f5c518; }
.picker-selected-ids .id-tag--tmdb { color: #01b4e4; }
.picker-selected-ids .id-tag--tvdb { color: #6cd161; }

.picker-clear {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  transition: all 0.15s;
}
.picker-clear:hover {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
}

/* ─── Manual fallback ──────────────────────────────────────── */
.picker-manual summary {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  padding: 0.4rem 0;
  list-style: none;
}
.picker-manual summary::-webkit-details-marker {
  display: none;
}
.picker-manual summary:hover {
  color: rgb(var(--fg-strong));
}
.picker-manual[open] summary {
  margin-bottom: 0.85rem;
  color: rgb(var(--fg-strong));
}
.picker-manual .id-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.65rem;
  margin-bottom: 0.85rem;
}
@media (max-width: 640px) {
  .picker-manual .id-grid {
    grid-template-columns: 1fr;
  }
}
.picker-manual label {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}
.picker-manual .id-tag {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.picker-manual .id-tag--imdb { color: #f5c518; }
.picker-manual .id-tag--tmdb { color: #01b4e4; }
.picker-manual .id-tag--tvdb { color: #6cd161; }
.picker-manual .id-input {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 0.8rem;
}
.btn-ghost--small {
  padding: 0.4rem 0.7rem;
  font-size: 10px;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  color: rgb(var(--fg-default));
  background: rgb(var(--bg-elevated));
  transition: all 0.15s;
}
.btn-ghost--small:hover:not(:disabled) {
  border-color: rgb(var(--fg-default) / 0.3);
  color: rgb(var(--fg-strong));
}
.btn-ghost--small:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

/* Transition for dropdown */
.picker-fade-enter-active,
.picker-fade-leave-active {
  transition: opacity 0.12s, transform 0.12s;
}
.picker-fade-enter-from,
.picker-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
