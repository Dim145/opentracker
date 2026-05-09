<template>
  <div v-if="torrent" class="upload-page">
    <!-- Header -->
    <div class="upload-header">
      <NuxtLink :to="`/torrents/${torrent.infoHash}`" class="back-link">
        <Icon name="ph:arrow-left-bold" />
        Back to release
      </NuxtLink>
      <div class="upload-title-row">
        <div>
          <p class="page-eyebrow">Editing · {{ torrent.infoHash.slice(0, 12) }}…</p>
          <h1 class="page-title">
            Edit <span class="page-title-accent">release</span>
          </h1>
        </div>
        <div class="ready-state idle">
          <Icon name="ph:pencil-simple-bold" />
          <span>Owner / mod</span>
        </div>
      </div>
    </div>

    <!-- Form -->
    <div class="upload-grid">
      <!-- ─────────────────────────  MAIN COLUMN  ───────────────────────── -->
      <div class="upload-main">
        <!-- 01 CATEGORY -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">01</span>
            <h2 class="section-title">Category</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <label class="field-row">
              <span class="field-label">Category</span>
              <select
                v-model="selectedCategoryId"
                class="input field-input field-input--select"
              >
                <option value="">No category</option>
                <option
                  v-for="cat in flatCategories"
                  :key="cat.id"
                  :value="cat.id"
                >
                  {{ cat.name }}
                </option>
              </select>
            </label>
          </div>
        </section>

        <!-- 02 SOURCE -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">02</span>
            <h2 class="section-title">Source &amp; title</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <div class="readonly-name">
              <span class="field-label">.torrent file</span>
              <p>
                {{ torrent.name }}
                <span class="readonly-name-meta"
                  >· {{ formatSize(torrent.size) }} ·
                  <code>{{ torrent.infoHash.slice(0, 12) }}…</code></span
                >
              </p>
            </div>
            <label class="field-row">
              <span class="field-label">
                Title<span class="section-required" aria-hidden="true">*</span>
              </span>
              <div class="field-with-action">
                <input
                  v-model="title"
                  type="text"
                  class="input field-input"
                  placeholder="The release name as you want it indexed"
                />
                <!-- Mirror of the upload page's "Parse title" button.
                     Re-runs `parseReleaseName` on the current title and
                     merges any newly-detected scene flags into the
                     tag list — useful when an admin imports an
                     existing release whose tags weren't filled at
                     upload time, or whose title was edited after the
                     fact. -->
                <button
                  type="button"
                  class="btn-ghost btn-ghost--small"
                  :disabled="!title.trim()"
                  title="Detect tags (resolution / source / codec / language / …) from the title"
                  @click="parseTitleNow"
                >
                  <Icon name="ph:wand" />
                  Parse title
                </button>
              </div>
            </label>
          </div>
        </section>

        <!-- 03 IDENTITY (only when category is movie/tv) -->
        <section v-if="categoryKindValue !== 'other'" class="form-section">
          <header class="section-head">
            <span class="section-number">03</span>
            <h2 class="section-title">Identity</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              Search TMDb to attach the right metadata, or paste an id
              manually below. Picking a result fills IMDb / TMDb / TVDB in
              one step.
            </p>
            <MediaSearchPicker
              :initial-query="parsedTitle"
              :initial-year="parsedYear"
              :type-hint="searchTypeHint"
              :selected="lookupResult ?? existingMetadata"
              :imdb-id="imdbId"
              :tmdb-id="tmdbId"
              :tvdb-id="tvdbId"
              @select="onMediaSelected"
              @clear="clearMediaSelection"
              @update:imdb-id="imdbId = $event"
              @update:tmdb-id="tmdbId = $event"
              @update:tvdb-id="tvdbId = $event"
            />
          </div>
        </section>

        <!-- DESCRIPTION (required) -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">{{
              categoryKindValue === 'other' ? '03' : '04'
            }}</span>
            <h2 class="section-title">Description<span class="section-required" aria-hidden="true">*</span></h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <WysiwygEditor
              v-model="description"
              format="markdown"
              placeholder="Describe the release. Paste BBCode, HTML or Markdown — it all converts."
            />
            <p
              v-if="!descriptionFilled"
              class="section-help section-help--warning"
            >
              <Icon name="ph:warning-circle" />
              A description is required.
            </p>
          </div>
        </section>

        <!-- TAGS -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">{{
              categoryKindValue === 'other' ? '04' : '05'
            }}</span>
            <h2 class="section-title">Tags</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <TagInput v-model="tagNames" placeholder="FHD, Full Season, NC…" />
            <p class="section-help">
              Press Enter or comma to add. Existing tags auto-suggest as you
              type.
            </p>
          </div>
        </section>

        <!-- NFO -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">{{
              categoryKindValue === 'other' ? '05' : '06'
            }}</span>
            <h2 class="section-title">NFO</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <div class="nfo-toolbar">
              <button
                type="button"
                class="btn-ghost btn-ghost--small"
                @click="triggerNfoInput"
              >
                <Icon name="ph:upload-simple-bold" />
                Upload .nfo
              </button>
              <button
                v-if="nfo"
                type="button"
                class="btn-ghost btn-ghost--small btn-ghost--danger"
                @click="nfo = ''"
              >
                <Icon name="ph:trash" />
                Clear
              </button>
            </div>
            <input
              ref="nfoInput"
              type="file"
              accept=".nfo,.txt,text/plain"
              class="hidden"
              @change="handleNfoSelect"
            />
            <textarea
              v-model="nfo"
              rows="10"
              class="input nfo-textarea"
              placeholder="Paste or upload an NFO release file…"
            />
          </div>
        </section>
      </div>

      <!-- ─────────────────────────  ASIDE  ───────────────────────── -->
      <aside class="upload-aside">
        <div class="aside-card">
          <p class="page-eyebrow">Live preview</p>

          <MediaMetadataCard
            v-if="lookupResult || existingMetadata"
            :metadata="lookupResult ?? existingMetadata"
            size="compact"
            class="aside-metadata"
          />
          <div v-else class="aside-summary">
            <p class="aside-name">{{ title || torrent.name }}</p>
            <div class="aside-stats">
              <span>{{ formatSize(torrent.size) }}</span>
              <span class="aside-dot">·</span>
              <code>{{ torrent.infoHash.slice(0, 12) }}…</code>
            </div>
          </div>

          <div v-if="categoryLabel" class="aside-row">
            <span>Category</span>
            <strong>{{ categoryLabel }}</strong>
          </div>
          <div v-if="tagNames.length > 0" class="aside-row aside-row--column">
            <span>Tags</span>
            <div class="aside-tags">
              <span v-for="t in tagNames" :key="t" class="aside-tag">{{
                t
              }}</span>
            </div>
          </div>

          <div v-if="dirtyCount > 0" class="aside-pending">
            <Icon name="ph:pencil-line-bold" />
            <span>{{ dirtyCount }} unsaved change{{ dirtyCount === 1 ? '' : 's' }}</span>
          </div>
        </div>
      </aside>
    </div>

    <!-- Sticky action bar -->
    <div class="action-bar">
      <div class="action-bar-inner">
        <NuxtLink
          :to="`/torrents/${torrent.infoHash}`"
          class="btn btn-secondary"
        >
          <Icon name="ph:x-bold" />
          Cancel
        </NuxtLink>
        <span class="action-bar-status">
          <span v-if="error" class="action-error">
            <Icon name="ph:warning-circle-fill" />
            {{ error }}
          </span>
          <span v-else-if="!title.trim()" class="action-hint">
            Title is required
          </span>
          <span v-else-if="!descriptionFilled" class="action-hint">
            Description is required
          </span>
          <span v-else-if="dirtyCount === 0" class="action-hint">
            No changes to save
          </span>
          <span v-else class="action-ready">
            <Icon name="ph:floppy-disk" />
            {{ dirtyCount }} change{{ dirtyCount === 1 ? '' : 's' }} pending
          </span>
        </span>
        <button
          type="button"
          class="btn btn-primary action-submit"
          :disabled="!canSave || isSaving"
          @click="save"
        >
          <Icon
            :name="isSaving ? 'ph:circle-notch' : 'ph:floppy-disk-bold'"
            :class="{ 'animate-spin': isSaving }"
          />
          {{ isSaving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </div>
  </div>

  <!-- Loading / 404 -->
  <div v-else-if="pending" class="upload-page upload-loading">
    <Icon name="ph:circle-notch" class="animate-spin h-8 w-8" />
  </div>
  <div v-else class="upload-page upload-loading">
    <p class="text-text-muted">Torrent not found.</p>
  </div>
</template>

<script setup lang="ts">
import { formatSize } from '~/utils/format';
import {
  findCategory,
  categoryKind,
  categoryTypeHint as resolveCategoryTypeHint,
  getFlattenedCategories,
  type CategoryNode,
} from '~/utils/categories';
import { mergeParsedTags, parseReleaseName } from '~/utils/releaseParse';
import { useNotificationStore } from '~/stores/notifications';

definePageMeta({ title: 'Edit torrent' });

interface TorrentDetail {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  description: string | null;
  nfo: string | null;
  uploaderId: string | null;
  categoryId: string | null;
  category: {
    id: string;
    name: string;
    slug?: string;
    newznabId?: number | null;
  } | null;
  tags?: Array<{ id: string; name: string; slug: string; color: string }>;
  imdbId?: string | null;
  tmdbId?: string | null;
  tvdbId?: string | null;
}

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

const route = useRoute();
const router = useRouter();
const notifications = useNotificationStore();

const hash = route.params.hash as string;

const {
  data: torrent,
  pending,
} = await useFetch<TorrentDetail>(`/api/torrents/${hash}`);

const { data: categories } = await useFetch<CategoryNode[]>('/api/categories');
const flatCategories = computed(() => getFlattenedCategories(categories.value));

const nfoInput = ref<HTMLInputElement | null>(null);
const selectedCategoryId = ref('');
const title = ref('');
const description = ref('');
const nfo = ref('');
const tagNames = ref<string[]>([]);
const imdbId = ref('');
const tmdbId = ref('');
const tvdbId = ref('');
const isSaving = ref(false);
const error = ref<string | null>(null);
const NFO_MAX_BYTES = 256 * 1024;

// Snapshot of the loaded values so we can highlight dirty fields.
interface Snapshot {
  name: string;
  category: string;
  description: string;
  nfo: string;
  tags: string[];
  imdb: string;
  tmdb: string;
  tvdb: string;
}
const snapshot = ref<Snapshot | null>(null);

watch(
  torrent,
  (t) => {
    if (!t) return;
    title.value = t.name || '';
    selectedCategoryId.value = t.categoryId || '';
    description.value = t.description || '';
    nfo.value = t.nfo || '';
    tagNames.value = t.tags?.map((tag) => tag.name) ?? [];
    imdbId.value = t.imdbId || '';
    tmdbId.value = t.tmdbId || '';
    tvdbId.value = t.tvdbId || '';
    snapshot.value = {
      name: title.value,
      category: selectedCategoryId.value,
      description: description.value,
      nfo: nfo.value,
      tags: [...tagNames.value],
      imdb: imdbId.value,
      tmdb: tmdbId.value,
      tvdb: tvdbId.value,
    };
  },
  { immediate: true }
);

// Parsed release info from the saved name — used to seed the search
// picker with a sensible default query when the operator first opens
// the Identity section.
const parsedFromName = computed(() =>
  torrent.value ? parseReleaseName(torrent.value.name) : null
);
const parsedTitle = computed(() => parsedFromName.value?.title ?? '');
const parsedYear = computed(() => parsedFromName.value?.year ?? null);

/**
 * "Parse title" button handler — same logic as the upload page.
 * Re-runs the parser on the current Title field and folds any newly
 * detected scene flags into the tag list (case-insensitive merge so
 * the user's manual entries aren't duplicated). The title itself is
 * never overwritten — the editor controls it.
 */
function parseTitleNow() {
  const value = title.value.trim();
  if (!value) return;
  const r = parseReleaseName(value);
  if (r.tags.length === 0) {
    notifications.info('No tags detected from the title.');
    return;
  }
  const { merged, added } = mergeParsedTags(tagNames.value, r.tags);
  tagNames.value = merged;
  if (added.length === 0) {
    notifications.success('Title parsed — every detected tag was already on.');
  } else {
    notifications.success(
      `Added ${added.length} tag${added.length === 1 ? '' : 's'}: ${added.join(', ')}`
    );
  }
}

const dirtyCount = computed(() => {
  const s = snapshot.value;
  if (!s) return 0;
  let n = 0;
  if (s.name !== title.value) n++;
  if (s.category !== selectedCategoryId.value) n++;
  if (s.description !== description.value) n++;
  if (s.nfo !== nfo.value) n++;
  if (
    s.tags.length !== tagNames.value.length ||
    s.tags.some((t, i) => t !== tagNames.value[i])
  )
    n++;
  if (s.imdb !== imdbId.value) n++;
  if (s.tmdb !== tmdbId.value) n++;
  if (s.tvdb !== tvdbId.value) n++;
  return n;
});

const selectedCategory = computed(() =>
  findCategory(categories.value as CategoryNode[] | null, selectedCategoryId.value)
);
const categoryKindValue = computed(() => categoryKind(selectedCategory.value));
const searchTypeHint = computed(
  () => resolveCategoryTypeHint(selectedCategory.value) ?? parsedFromName.value?.kind ?? undefined
);
const categoryLabel = computed(() => selectedCategory.value?.name ?? null);

const descriptionFilled = computed(
  () => description.value.trim().length > 0
);

const canSave = computed(
  () =>
    !!title.value.trim() &&
    descriptionFilled.value &&
    dirtyCount.value > 0
);

// Lookup state — fed by the picker.
const lookupResult = ref<MediaMetadata | null>(null);

// Pre-load existing metadata so the aside shows context immediately.
const existingMetadata = ref<MediaMetadata | null>(null);

async function loadExistingMetadata() {
  const t = torrent.value;
  if (!t) return;
  const params: Record<string, string> | null = t.tmdbId
    ? { source: 'tmdb', id: t.tmdbId }
    : t.imdbId
      ? { source: 'imdb', id: t.imdbId }
      : t.tvdbId
        ? { source: 'tvdb', id: t.tvdbId }
        : null;
  if (!params) return;
  const type = resolveCategoryTypeHint(selectedCategory.value);
  if (type) params.type = type;
  try {
    const res = await $fetch<{ enabled: boolean; metadata: MediaMetadata | null }>(
      '/api/metadata/lookup',
      { query: params }
    );
    if (res.enabled && res.metadata) existingMetadata.value = res.metadata;
  } catch {
    // Metadata is opt-in; failures don't block the form.
  }
}

watch(torrent, () => {
  loadExistingMetadata();
});

function onMediaSelected(metadata: MediaMetadata) {
  lookupResult.value = metadata;
  imdbId.value = metadata.imdbId ?? '';
  tmdbId.value = metadata.tmdbId ? `${metadata.type}/${metadata.tmdbId}` : '';
  tvdbId.value = metadata.tvdbId != null ? String(metadata.tvdbId) : '';
}
function clearMediaSelection() {
  lookupResult.value = null;
  existingMetadata.value = null;
  imdbId.value = '';
  tmdbId.value = '';
  tvdbId.value = '';
}

function triggerNfoInput() {
  nfoInput.value?.click();
}

async function handleNfoSelect(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > NFO_MAX_BYTES) {
    error.value = `NFO file is too large (max ${Math.round(NFO_MAX_BYTES / 1024)} KB)`;
    return;
  }
  try {
    nfo.value = await file.text();
    error.value = null;
  } catch {
    error.value = 'Could not read the NFO file';
  } finally {
    if (nfoInput.value) nfoInput.value.value = '';
  }
}

async function save() {
  if (!torrent.value || !canSave.value) return;
  isSaving.value = true;
  error.value = null;
  try {
    // Submit IDs only when the category supports them. For "other"
    // categories we explicitly clear the columns so an old movie tag
    // doesn't survive a recategorisation to e.g. Audio.
    const idPayload =
      categoryKindValue.value === 'other'
        ? { imdbId: null, tmdbId: null, tvdbId: null }
        : {
            imdbId: imdbId.value.trim() || null,
            tmdbId: tmdbId.value.trim() || null,
            tvdbId: tvdbId.value.trim() || null,
          };

    const res = await fetch(
      `/api/torrents/${torrent.value.infoHash}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: title.value.trim(),
          description: description.value,
          categoryId: selectedCategoryId.value || null,
          nfo: nfo.value,
          ...idPayload,
        }),
      }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to save changes');
    }

    const tagsRes = await fetch(
      `/api/torrents/${torrent.value.infoHash}/tags`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: tagNames.value }),
      }
    );
    if (!tagsRes.ok) {
      const data = await tagsRes.json().catch(() => ({}));
      throw new Error(data.message || 'Failed to save tags');
    }

    notifications.success('Changes saved');
    router.push(`/torrents/${torrent.value.infoHash}`);
  } catch (err: unknown) {
    const fetchError = err as { message?: string };
    error.value = fetchError.message || 'Failed to save changes';
  } finally {
    isSaving.value = false;
  }
}

useHead({ title: 'Edit torrent' });
</script>

<style scoped>
@import '~/assets/css/upload-form.css';

.upload-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  gap: 1rem;
}

.readonly-name {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  padding: 0.75rem 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.375rem;
}
.readonly-name p {
  margin: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  word-break: break-all;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.readonly-name-meta {
  font-size: 0.7rem;
  font-weight: 500;
  color: rgb(var(--fg-muted));
  font-family: ui-monospace, SFMono-Regular, monospace;
  margin-left: 0.4rem;
}

.section-required {
  color: rgb(var(--danger));
  margin-left: 0.25rem;
  font-size: 0.65rem;
  letter-spacing: 0;
}
.section-help--warning {
  color: rgb(var(--danger));
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.nfo-toolbar {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}
.btn-ghost--small {
  padding: 0.35rem 0.7rem;
  font-size: 10px;
}
.btn-ghost--danger:hover {
  color: rgb(var(--danger));
  border-color: rgb(var(--danger) / 0.4);
}
.nfo-textarea {
  font-family: 'IBM Plex Mono', 'Cascadia Code', Menlo, ui-monospace, monospace;
  white-space: pre;
  overflow-x: auto;
  tab-size: 4;
  resize: vertical;
}

.aside-pending {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.75rem;
  border-radius: 9999px;
  border: 1px solid rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
  color: #f5c518;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}
</style>
