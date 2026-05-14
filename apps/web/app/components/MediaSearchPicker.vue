<template>
  <div ref="root" class="picker">
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
              ? t('components.mediaSearch.placeholderTv')
              : typeHint === 'movie'
                ? t('components.mediaSearch.placeholderMovie')
                : typeHint === 'game'
                  ? t('components.mediaSearch.placeholderGame')
                  : typeHint === 'book'
                    ? t('components.mediaSearch.placeholderBook')
                    : t('components.mediaSearch.placeholderAny')
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
            {{ t('components.mediaSearch.noMatchesPrefix') }} <em>{{ debouncedQuery }}</em>
          </p>
          <ul v-else class="picker-list">
            <li
              v-for="(hit, i) in results"
              :key="`${hit.source}-${hit.type}-${hit.id}`"
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
                          : hit.type === 'tv'
                            ? 'ph:television-simple-bold'
                            : hit.type === 'game'
                              ? 'ph:game-controller-bold'
                              : 'ph:book-open-text-bold'
                      "
                    />
                    {{
                      hit.type === 'movie'
                        ? t('components.mediaSearch.movie')
                        : hit.type === 'tv'
                          ? t('components.mediaSearch.tv')
                          : hit.type === 'game'
                            ? t('components.mediaSearch.game')
                            : t('components.mediaSearch.book')
                    }}
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
            <kbd>↑</kbd><kbd>↓</kbd> {{ t('components.mediaSearch.kbdHint') }} · <kbd>Enter</kbd> {{ t('components.mediaSearch.kbdHintPick') }}
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
          <span v-if="selected.tmdbId" class="id-tag id-tag--tmdb"
            >{{ t('components.mediaSearch.tmdbBadge', { id: selected.tmdbId }) }}</span
          >
          <span v-if="selected.imdbId" class="id-tag id-tag--imdb">{{
            selected.imdbId
          }}</span>
          <span v-if="selected.tvdbId" class="id-tag id-tag--tvdb"
            >{{ t('components.mediaSearch.tvdbBadge', { id: selected.tvdbId }) }}</span
          >
          <span v-if="selected.igdbId" class="id-tag id-tag--igdb"
            >{{ t('components.mediaSearch.igdbBadge', { id: selected.igdbId }) }}</span
          >
          <span
            v-if="selected.openlibraryId || selected.isbn13 || selected.isbn10"
            class="id-tag id-tag--openlibrary"
          >{{
            t('components.mediaSearch.openlibraryBadge', {
              id:
                selected.isbn13 ??
                selected.isbn10 ??
                selected.openlibraryId ??
                ''
            })
          }}</span>
        </div>
      </div>
      <button type="button" class="picker-clear" @click="clearSelection">
        <Icon name="ph:x-bold" />
        <span>{{ t('components.mediaSearch.clear') }}</span>
      </button>
    </div>

    <!-- Manual ID fallback -->
    <details class="picker-manual">
      <summary>
        <Icon name="ph:identification-card-bold" />
        {{ t('components.mediaSearch.manualToggle') }}
      </summary>
      <div class="id-grid">
        <!-- Movie / TV / null category: surface the TMDb-family IDs.
             Hiding IGDB / Open Library here keeps the operator from
             mistakenly pasting the wrong namespace into a film row
             (and vice versa for the game / book branches below). -->
        <template v-if="typeHint !== 'game' && typeHint !== 'book'">
          <label>
            <span class="id-tag id-tag--imdb">{{ t('components.mediaSearch.imdb') }}</span>
            <input
              :value="imdbId"
              type="text"
              class="input id-input"
              placeholder="tt1234567"
              @input="$emit('update:imdbId', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span class="id-tag id-tag--tmdb">{{ t('components.mediaSearch.tmdb') }}</span>
            <input
              :value="tmdbId"
              type="text"
              class="input id-input"
              placeholder="12345 or tv/12345"
              @input="$emit('update:tmdbId', ($event.target as HTMLInputElement).value)"
            />
          </label>
          <label>
            <span class="id-tag id-tag--tvdb">{{ t('components.mediaSearch.tvdb') }}</span>
            <input
              :value="tvdbId"
              type="text"
              class="input id-input"
              placeholder="78804"
              @input="$emit('update:tvdbId', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
        <!-- Game category: only IGDB. -->
        <template v-if="typeHint === 'game'">
          <label>
            <span class="id-tag id-tag--igdb">{{ t('components.mediaSearch.igdb') }}</span>
            <input
              :value="igdbId"
              type="text"
              class="input id-input"
              placeholder="7346 or zelda-breath-of-the-wild"
              @input="$emit('update:igdbId', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
        <!-- Book category: only Open Library. ISBN-10, ISBN-13 and
             OL work ids are all accepted; the API normalises. -->
        <template v-if="typeHint === 'book'">
          <label>
            <span class="id-tag id-tag--openlibrary">{{ t('components.mediaSearch.openlibrary') }}</span>
            <input
              :value="openlibraryId"
              type="text"
              class="input id-input"
              placeholder="9780553573404 or OL27448W"
              @input="$emit('update:openlibraryId', ($event.target as HTMLInputElement).value)"
            />
          </label>
        </template>
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
        {{ resolving ? t('components.mediaSearch.resolving') : t('components.mediaSearch.resolveAndPreview') }}
      </button>
    </details>
  </div>
</template>

<script setup lang="ts">
interface MediaSearchHit {
  source: 'tmdb' | 'imdb' | 'tvdb' | 'igdb' | 'openlibrary';
  type: 'movie' | 'tv' | 'game' | 'book';
  /** Source-side canonical id (string for portability — TMDb numeric,
   *  IGDB numeric, IMDb tt-prefixed, ISBN-13 / OL work id for books). */
  id: string;
  title: string;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  url: string;
}

/** Full normalised metadata returned by /api/metadata/lookup. */
interface MediaMetadata {
  source: 'tmdb' | 'imdb' | 'tvdb' | 'igdb' | 'openlibrary';
  type: 'movie' | 'tv' | 'game' | 'book';
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  igdbId?: number | null;
  openlibraryId?: string | null;
  isbn13?: string | null;
  isbn10?: string | null;
  title: string;
  year: number | null;
  posterUrl: string | null;
  [key: string]: unknown;
}

const { t } = useI18n();

const props = defineProps<{
  initialQuery?: string;
  initialYear?: number | null;
  /** Type hint from the category. Drives both the search-source
   *  pick ('game' → IGDB, 'book' → Open Library, else TMDb) and
   *  the constrained type filter inside the source. */
  typeHint?: 'movie' | 'tv' | 'game' | 'book';
  /** Auto-fire a search for `initialQuery` when it lands non-empty. */
  autoSearch?: boolean;
  /** Currently-resolved metadata (so the chip survives parent re-renders). */
  selected?: MediaMetadata | null;
  /** Manual fallback bindings — wired straight to parent state. */
  imdbId?: string;
  tmdbId?: string;
  tvdbId?: string;
  igdbId?: string;
  openlibraryId?: string;
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
  (e: 'update:igdbId', value: string): void;
  (e: 'update:openlibraryId', value: string): void;
}>();

/** Game → IGDB, book → Open Library, everything else → TMDb. The
 *  endpoint dispatches on the source param so disabled providers
 *  surface a clean 503 instead of degrading silently. */
const searchSource = computed<'tmdb' | 'igdb' | 'openlibrary'>(() => {
  if (props.typeHint === 'game') return 'igdb';
  if (props.typeHint === 'book') return 'openlibrary';
  return 'tmdb';
});

const rawQuery = ref(props.initialQuery ?? '');
const debouncedQuery = ref('');
const open = ref(false);
const loading = ref(false);
const resolving = ref(false);
const error = ref<string | null>(null);
const results = ref<MediaSearchHit[]>([]);
const focusIndex = ref(-1);

// Monotonic tokens guard the search + lookup flows against
// out-of-order resolutions. Each in-flight call captures the value
// of the relevant ref at request time and bails when it no longer
// matches at resolve time. Without these tokens a user clicking
// result A then result B (with A's lookup slower than B's) would
// end up with A's metadata stuck in the parent — the bug the
// previous code-review pass flagged for picker + preflight + the
// category-change clear path.
let searchToken = 0;
let resolveToken = 0;

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
  const myToken = ++searchToken;
  loading.value = true;
  error.value = null;
  try {
    const params: Record<string, string | number> = {
      query: q,
      source: searchSource.value,
    };
    if (props.typeHint) params.type = props.typeHint;
    // IGDB ignores year filtering; TMDb honours it via /search/* and
    // Open Library honours it via `first_publish_year`. Skip the
    // round-trip when it would be ignored anyway.
    if (
      props.initialYear &&
      (searchSource.value === 'tmdb' || searchSource.value === 'openlibrary')
    ) {
      params.year = props.initialYear;
    }
    const res = await $fetch<{
      enabled: boolean;
      message?: string;
      results: MediaSearchHit[];
    }>('/api/metadata/search', { query: params });
    if (myToken !== searchToken) return; // a newer query took over
    if (!res.enabled) {
      error.value = res.message || t('components.mediaSearch.errors.metadataNotConfigured');
      results.value = [];
    } else {
      results.value = res.results;
      focusIndex.value = res.results.length > 0 ? 0 : -1;
    }
  } catch (err: any) {
    if (myToken !== searchToken) return;
    error.value =
      err?.data?.message || err?.message || t('components.mediaSearch.errors.searchFailed');
    results.value = [];
  } finally {
    if (myToken === searchToken) loading.value = false;
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
  // Pull the full record so the parent gets every cross-database
  // id IGDB or TMDb know about in one go. TMDb needs the type-
  // prefixed id (`movie/123`) to skip its namespace guess; IGDB
  // takes the bare numeric id.
  const myToken = ++resolveToken;
  resolving.value = true;
  error.value = null;
  try {
    const lookupId =
      hit.source === 'tmdb' ? `${hit.type}/${hit.id}` : hit.id;
    const res = await $fetch<{
      enabled: boolean;
      found: boolean;
      metadata: MediaMetadata | null;
    }>('/api/metadata/lookup', {
      query: { source: hit.source, id: lookupId },
    });
    if (myToken !== resolveToken) return;
    if (res.enabled && res.found && res.metadata) {
      emit('select', res.metadata);
    } else {
      error.value = t('components.mediaSearch.errors.couldNotLoadDetails');
    }
  } catch (err: any) {
    if (myToken !== resolveToken) return;
    error.value = err?.data?.message || err?.message || t('components.mediaSearch.errors.lookupFailed');
  } finally {
    if (myToken === resolveToken) resolving.value = false;
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
      (props.tvdbId ?? '').trim() ||
      (props.igdbId ?? '').trim() ||
      (props.openlibraryId ?? '').trim()
    )
);

async function resolveManual() {
  const params: Record<string, string> | null = (props.openlibraryId ?? '').trim()
    ? { source: 'openlibrary', id: (props.openlibraryId ?? '').trim() }
    : (props.igdbId ?? '').trim()
      ? { source: 'igdb', id: (props.igdbId ?? '').trim() }
      : (props.tmdbId ?? '').trim()
        ? { source: 'tmdb', id: (props.tmdbId ?? '').trim() }
        : (props.imdbId ?? '').trim()
          ? { source: 'imdb', id: (props.imdbId ?? '').trim() }
          : (props.tvdbId ?? '').trim()
            ? { source: 'tvdb', id: (props.tvdbId ?? '').trim() }
            : null;
  if (!params) return;
  if (props.typeHint) (params as Record<string, string>).type = props.typeHint;
  const myToken = ++resolveToken;
  resolving.value = true;
  error.value = null;
  try {
    const res = await $fetch<{
      enabled: boolean;
      found: boolean;
      metadata: MediaMetadata | null;
    }>('/api/metadata/lookup', { query: params });
    if (myToken !== resolveToken) return;
    if (!res.enabled) {
      error.value = t('components.mediaSearch.errors.metadataLookupNotConfigured');
    } else if (!res.found) {
      error.value = t('components.mediaSearch.errors.noMatchFor', { source: params.source.toUpperCase(), id: params.id });
    } else if (res.metadata) {
      emit('select', res.metadata);
    }
  } catch (err: any) {
    if (myToken !== resolveToken) return;
    error.value = err?.data?.message || err?.message || t('components.mediaSearch.errors.lookupFailed');
  } finally {
    if (myToken === resolveToken) resolving.value = false;
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
.picker-kind--game {
  border-color: rgba(167, 139, 250, 0.45);
  color: #a78bfa;
  background: rgba(167, 139, 250, 0.08);
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
.picker-selected-ids .id-tag--igdb { color: #a78bfa; }
.picker-selected-ids .id-tag--openlibrary { color: #d97706; }

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
.picker-manual .id-tag--igdb { color: #a78bfa; }
.picker-manual .id-tag--openlibrary { color: #d97706; }
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
