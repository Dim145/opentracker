<template>
  <div class="upload-page">
    <!-- Header -->
    <div class="upload-header">
      <NuxtLink to="/torrents" class="back-link">
        <Icon name="ph:arrow-left-bold" />
        Back to index
      </NuxtLink>
      <div class="upload-title-row">
        <div>
          <p class="page-eyebrow">New entry · Indexer</p>
          <h1 class="page-title">
            Upload <span class="page-title-accent">a release</span>
          </h1>
        </div>
        <div
          v-if="readyState && !result"
          class="ready-state"
          :class="readyState.tone"
        >
          <Icon :name="readyState.icon" />
          <span>{{ readyState.label }}</span>
        </div>
        <div v-else-if="result" class="ready-state ready">
          <Icon name="ph:check-circle-fill" />
          <span>Indexed</span>
        </div>
      </div>
    </div>

    <!-- Result panel — replaces the form once the upload succeeds. -->
    <div v-if="result" class="result-shell">
      <div class="result-card">
        <div class="result-success">
          <Icon name="ph:check-circle-fill" class="result-icon" />
          <div>
            <h2>{{ result.message }}</h2>
            <p>The release is now indexed and ready to share.</p>
          </div>
        </div>
        <dl class="result-meta">
          <div>
            <dt>Name</dt>
            <dd>{{ result.data.name }}</dd>
          </div>
          <div>
            <dt>Hash</dt>
            <dd>
              <code>{{ result.data.infoHash }}</code>
            </dd>
          </div>
          <div>
            <dt>Size</dt>
            <dd>{{ formatSize(result.data.size) }}</dd>
          </div>
        </dl>
        <div class="result-actions">
          <a
            :href="`/api/torrents/${result.data.infoHash}/download`"
            class="btn btn-secondary"
            :download="`${result.data.name}.torrent`"
          >
            <Icon name="ph:download-simple-bold" />
            Download .torrent
          </a>
          <NuxtLink
            :to="`/torrents/${result.data.infoHash}`"
            class="btn btn-primary"
          >
            View release
            <Icon name="ph:arrow-right-bold" />
          </NuxtLink>
        </div>
        <button type="button" class="result-link" @click="resetForm">
          <Icon name="ph:plus-circle-bold" />
          Upload another release
        </button>
      </div>
    </div>

    <!-- Form -->
    <div v-else class="upload-grid">
      <!-- ─────────────────────────  MAIN COLUMN  ───────────────────────── -->
      <div class="upload-main">
        <!-- 01 CATEGORY (drives whether IDs section shows) -->
        <section class="form-section">
          <header class="section-head">
            <span class="section-number">01</span>
            <h2 class="section-title">Category</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              Pick the category first — movie or TV categories unlock the
              metadata search.
            </p>
            <label class="field-row">
              <span class="field-label">Category</span>
              <select
                v-model="selectedCategoryId"
                class="input field-input field-input--select"
              >
                <option value="">Select a category…</option>
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
            <!-- Drop zone -->
            <div
              class="drop-zone"
              :class="{
                'drop-zone--filled': selectedFile,
                'drop-zone--dragging': dragActive,
              }"
              @click="triggerFileInput"
              @drop.prevent="handleDrop"
              @dragenter.prevent="dragActive = true"
              @dragover.prevent="dragActive = true"
              @dragleave.prevent="dragActive = false"
            >
              <input
                ref="fileInput"
                type="file"
                accept=".torrent"
                class="hidden"
                @change="handleFileSelect"
              />
              <template v-if="!selectedFile">
                <div class="drop-icon">
                  <Icon name="ph:file-arrow-up-bold" />
                </div>
                <p class="drop-headline">Drop your <code>.torrent</code> here</p>
                <p class="drop-sub">or click to browse the filesystem</p>
              </template>
              <template v-else>
                <div class="drop-icon drop-icon--success">
                  <Icon name="ph:check-circle-fill" />
                </div>
                <p class="drop-headline">{{ selectedFile.name }}</p>
                <p class="drop-sub">
                  {{ formatSize(selectedFile.size) }} · ready
                  <button
                    type="button"
                    class="drop-clear"
                    @click.stop="clearFile"
                  >
                    swap file
                  </button>
                </p>
              </template>
            </div>

            <!-- Title (editable) -->
            <label class="field-row">
              <span class="field-label">
                Title
                <span class="field-hint">override the parsed name</span>
              </span>
              <div class="field-with-action">
                <input
                  v-model="title"
                  type="text"
                  class="input field-input"
                  placeholder="The release name as you want it indexed"
                  :disabled="!selectedFile"
                />
                <!-- Re-parse the *current title* (not the filename) and
                     fold any newly-detected tags into the tag list.
                     Useful when the user hand-types a release name or
                     pastes one from a tracker page that doesn't carry
                     the original filename. The same parser handles
                     both inputs — no fork. -->
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

        <!-- 03 IDENTITY (only for movie/tv categories) -->
        <section v-if="categoryKindValue !== 'other'" class="form-section">
          <header class="section-head">
            <span class="section-number">03</span>
            <h2 class="section-title">Identity</h2>
            <span class="section-rule" />
          </header>

          <div class="section-body">
            <p class="section-help">
              We auto-search TMDb from the parsed title. Pick a result to
              attach IMDb / TMDb / TVDB ids in one step.
            </p>
            <MediaSearchPicker
              :initial-query="extractedTitle"
              :initial-year="parsed?.year ?? null"
              :type-hint="searchTypeHint"
              auto-search
              :selected="lookupResult"
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
              A description is required to publish.
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
            <TagInput v-model="tags" placeholder="FHD, Full Season, NC…" />
            <p class="section-help">
              <span v-if="autoTagApplied" class="section-help--auto">
                <Icon name="ph:sparkle-fill" />
                Auto-detected from filename — edit freely.
              </span>
              <span v-else>
                Press Enter or comma to add. Existing tags auto-suggest as you
                type.
              </span>
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
            <div
              class="drop-zone drop-zone--small"
              :class="{ 'drop-zone--filled': nfoFile }"
              @click="triggerNfoInput"
              @drop.prevent="handleNfoDrop"
              @dragover.prevent
            >
              <input
                ref="nfoInput"
                type="file"
                accept=".nfo,.txt,text/plain"
                class="hidden"
                @change="handleNfoSelect"
              />
              <template v-if="!nfoFile">
                <Icon name="ph:file-text-bold" class="drop-mini-icon" />
                <span>Drop or browse a <code>.nfo</code> file (optional)</span>
              </template>
              <template v-else>
                <Icon name="ph:check-circle-fill" class="drop-mini-icon drop-mini-icon--success" />
                <span class="drop-mini-name">{{ nfoFile.name }}</span>
                <span class="drop-mini-meta">{{ formatSize(nfoFile.size) }}</span>
                <button type="button" class="drop-clear" @click.stop="clearNfo">
                  remove
                </button>
              </template>
            </div>
          </div>
        </section>
      </div>

      <!-- ─────────────────────────  ASIDE  ───────────────────────── -->
      <aside class="upload-aside">
        <div class="aside-card">
          <p class="page-eyebrow">Live preview</p>

          <!-- Metadata preview if fetched -->
          <MediaMetadataCard
            v-if="lookupResult"
            :metadata="lookupResult"
            size="compact"
            class="aside-metadata"
          />
          <div v-else-if="title || selectedFile" class="aside-summary">
            <p class="aside-name">{{ title || selectedFile?.name }}</p>
            <div v-if="selectedFile" class="aside-stats">
              <span>{{ formatSize(selectedFile.size) }}</span>
              <span v-if="parsed?.year" class="aside-dot">·</span>
              <span v-if="parsed?.year">{{ parsed.year }}</span>
              <span
                v-if="parsed?.season !== null && parsed?.season !== undefined"
                class="aside-dot"
                >·</span
              >
              <span v-if="parsed?.season !== null && parsed?.season !== undefined">
                S{{ String(parsed.season).padStart(2, '0')
                }}<template v-if="parsed.episode !== null && parsed.episode !== undefined"
                  >E{{ String(parsed.episode).padStart(2, '0') }}</template
                >
              </span>
            </div>
          </div>
          <div v-else class="aside-placeholder">
            <Icon name="ph:cassette-tape" class="aside-placeholder-icon" />
            <p>
              Pick a category, then drop a <code>.torrent</code>. The preview
              fills as you go.
            </p>
          </div>

          <div v-if="categoryLabel" class="aside-row">
            <span>Category</span>
            <strong>{{ categoryLabel }}</strong>
          </div>
          <div v-if="tags.length > 0" class="aside-row aside-row--column">
            <span>Tags</span>
            <div class="aside-tags">
              <span v-for="t in tags" :key="t" class="aside-tag">{{ t }}</span>
            </div>
          </div>

          <hr class="aside-divider" />

          <ol class="aside-progress">
            <li :class="{ done: !!selectedCategoryId }">
              <Icon :name="selectedCategoryId ? 'ph:check-bold' : 'ph:circle'" />
              <span>Category</span>
            </li>
            <li :class="{ done: !!selectedFile }">
              <Icon :name="selectedFile ? 'ph:check-bold' : 'ph:circle'" />
              <span>Source file</span>
            </li>
            <li :class="{ done: !!title.trim() }">
              <Icon :name="title.trim() ? 'ph:check-bold' : 'ph:circle'" />
              <span>Title</span>
            </li>
            <li
              v-if="categoryKindValue !== 'other'"
              :class="{ done: !!lookupResult }"
            >
              <Icon :name="lookupResult ? 'ph:check-bold' : 'ph:circle'" />
              <span>Identity (optional)</span>
            </li>
            <li :class="{ done: descriptionFilled }">
              <Icon
                :name="descriptionFilled ? 'ph:check-bold' : 'ph:circle'"
              />
              <span>Description</span>
            </li>
          </ol>
        </div>
      </aside>
    </div>

    <!-- Sticky action bar -->
    <div v-if="!result" class="action-bar">
      <div class="action-bar-inner">
        <NuxtLink to="/torrents" class="btn btn-secondary">
          <Icon name="ph:x-bold" />
          Cancel
        </NuxtLink>
        <span class="action-bar-status">
          <span v-if="error" class="action-error">
            <Icon name="ph:warning-circle-fill" />
            {{ error }}
          </span>
          <span v-else-if="!selectedFile" class="action-hint">
            Drop a <code>.torrent</code> file to enable upload
          </span>
          <span v-else-if="!selectedCategoryId" class="action-hint">
            Pick a category first
          </span>
          <span v-else-if="!descriptionFilled" class="action-hint">
            Write a description to publish
          </span>
          <span v-else class="action-ready">
            <Icon name="ph:rocket-launch" />
            {{ formatSize(selectedFile.size) }} ready to publish
          </span>
        </span>
        <button
          type="button"
          class="btn btn-primary action-submit"
          :disabled="!canPublish || isUploading"
          @click="upload"
        >
          <Icon
            :name="isUploading ? 'ph:circle-notch' : 'ph:rocket-launch-bold'"
            :class="{ 'animate-spin': isUploading }"
          />
          {{ isUploading ? 'Publishing…' : 'Publish release' }}
        </button>
      </div>
    </div>
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
import {
  mergeParsedTags,
  parseReleaseName,
  type ParsedRelease,
} from '~/utils/releaseParse';
import { useNotificationStore } from '~/stores/notifications';

definePageMeta({ title: 'Upload torrent' });

interface TorrentResult {
  success: boolean;
  message: string;
  data: {
    id: string;
    infoHash: string;
    name: string;
    size: number;
    magnetLink: string;
  };
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

// Pre-fill the category from the URL when the user clicked
// "+ New topic" on a category page (or hit the empty-state CTA from
// a category-filtered listing).
const initialCategoryId =
  typeof route.query.categoryId === 'string' ? route.query.categoryId : '';

const fileInput = ref<HTMLInputElement | null>(null);
const nfoInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const nfoFile = ref<File | null>(null);
const selectedCategoryId = ref(initialCategoryId);
const title = ref('');
const description = ref('');
const tags = ref<string[]>([]);
const imdbId = ref('');
const tmdbId = ref('');
const tvdbId = ref('');
const isUploading = ref(false);
const result = ref<TorrentResult | null>(null);
const error = ref<string | null>(null);
const dragActive = ref(false);
// Flips true the first time we auto-fill tags from a parsed filename so
// the section help line can mention it. Resets to false the moment the
// user touches the tag list themselves so we don't keep claiming
// "auto-detected" after they've curated.
const autoTagApplied = ref(false);
const NFO_MAX_BYTES = 256 * 1024;

const { data: categories } = await useFetch<CategoryNode[]>('/api/categories');

const flatCategories = computed(() => getFlattenedCategories(categories.value));

const selectedCategory = computed(() =>
  findCategory(categories.value as CategoryNode[] | null, selectedCategoryId.value)
);

const categoryKindValue = computed(() => categoryKind(selectedCategory.value));

const searchTypeHint = computed(() => {
  // Prefer the category's hint; if the category is "other" we don't
  // show the picker at all, so this is only consulted for movie/tv.
  const fromCategory = resolveCategoryTypeHint(selectedCategory.value);
  if (fromCategory) return fromCategory;
  // Fall back to the filename-derived kind (so a strong S01E01 signal
  // still narrows the search even before a category is set — this only
  // matters if the picker is visible, but `categoryKindValue` gates that).
  return parsed.value?.kind ?? undefined;
});

const categoryLabel = computed(() => selectedCategory.value?.name ?? null);

const descriptionFilled = computed(
  () => description.value.trim().length > 0
);

// Derived release info from the chosen file. Re-computed whenever the
// title or filename changes so the live preview stays in sync.
const parsed = ref<ParsedRelease | null>(null);

const extractedTitle = computed(() => parsed.value?.title ?? '');

watch(selectedFile, (file) => {
  if (!file) {
    parsed.value = null;
    return;
  }
  const r = parseReleaseName(file.name);
  parsed.value = r;
  // Default the title field to the parsed clean title (or fall back to
  // the filename without extension). The user can still edit it.
  if (!title.value.trim()) {
    title.value = r.title || file.name.replace(/\.torrent$/i, '');
  }
  // Auto-tags — only if the user hasn't already typed any. We don't
  // want to clobber their work if they re-drop a different file.
  if (tags.value.length === 0 && r.tags.length > 0) {
    tags.value = r.tags;
    autoTagApplied.value = true;
  }
});

watch(tags, () => {
  // The moment the user edits the tag list, drop the "auto-detected"
  // hint label so the help text reverts to its normal copy.
  if (autoTagApplied.value) autoTagApplied.value = false;
}, { deep: true });

const notifications = useNotificationStore();

/**
 * "Parse title" button handler — re-runs the same parser used at
 * file-drop time, but on the current Title field instead of the
 * filename. Tags are merged (case-insensitive) into whatever is
 * already there so the user's manual entries aren't clobbered.
 */
function parseTitleNow() {
  const value = title.value.trim();
  if (!value) return;
  const r = parseReleaseName(value);
  if (r.tags.length === 0) {
    notifications.info('No tags detected from the title.');
    return;
  }
  const { merged, added } = mergeParsedTags(tags.value, r.tags);
  tags.value = merged;
  if (added.length === 0) {
    notifications.success('Title parsed — every detected tag was already on.');
  } else {
    autoTagApplied.value = true;
    notifications.success(
      `Added ${added.length} tag${added.length === 1 ? '' : 's'}: ${added.join(', ')}`
    );
  }
}

// Lookup state — populated by the picker emitting a normalised payload.
const lookupResult = ref<MediaMetadata | null>(null);

function onMediaSelected(metadata: MediaMetadata) {
  lookupResult.value = metadata;
  // Mirror the resolved ids into the manual fallback fields so they
  // submit with the form even though the user picked via the search UI.
  imdbId.value = metadata.imdbId ?? '';
  tmdbId.value = metadata.tmdbId ? `${metadata.type}/${metadata.tmdbId}` : '';
  tvdbId.value = metadata.tvdbId != null ? String(metadata.tvdbId) : '';
}
function clearMediaSelection() {
  lookupResult.value = null;
  imdbId.value = '';
  tmdbId.value = '';
  tvdbId.value = '';
}

// File handling
function triggerFileInput() {
  fileInput.value?.click();
}

function handleFileSelect(e: Event) {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0];
  if (file && file.name.endsWith('.torrent')) {
    selectedFile.value = file;
    error.value = null;
  } else {
    error.value = 'Please select a .torrent file';
  }
}

function handleDrop(e: DragEvent) {
  dragActive.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (file && file.name.endsWith('.torrent')) {
    selectedFile.value = file;
    error.value = null;
  } else {
    error.value = 'Please drop a .torrent file';
  }
}

function clearFile() {
  selectedFile.value = null;
  // Reset everything that depends on the file: title, parsed metadata
  // and any lookup state that might no longer apply. The user has to
  // re-pick a file anyway, and surprise leftovers are worse than
  // re-typing.
  title.value = '';
  parsed.value = null;
  if (autoTagApplied.value) {
    tags.value = [];
    autoTagApplied.value = false;
  }
  if (fileInput.value) fileInput.value.value = '';
}

// NFO file handling
function triggerNfoInput() {
  nfoInput.value?.click();
}

function pickNfo(file: File | null | undefined): boolean {
  if (!file) return false;
  if (file.size > NFO_MAX_BYTES) {
    error.value = `NFO file is too large (max ${Math.round(NFO_MAX_BYTES / 1024)} KB)`;
    return false;
  }
  nfoFile.value = file;
  error.value = null;
  return true;
}

function handleNfoSelect(e: Event) {
  pickNfo((e.target as HTMLInputElement).files?.[0]);
}

function handleNfoDrop(e: DragEvent) {
  pickNfo(e.dataTransfer?.files?.[0]);
}

function clearNfo() {
  nfoFile.value = null;
  if (nfoInput.value) nfoInput.value.value = '';
}

// Header status pill + submit-enable rule.
interface ReadyHint {
  icon: string;
  label: string;
  tone: 'idle' | 'partial' | 'ready';
}
const readyState = computed<ReadyHint | null>(() => {
  if (!selectedCategoryId.value)
    return { icon: 'ph:folders-bold', label: 'Pick a category', tone: 'idle' };
  if (!selectedFile.value)
    return { icon: 'ph:cassette-tape', label: 'Awaiting source file', tone: 'partial' };
  if (!title.value.trim())
    return { icon: 'ph:textbox-bold', label: 'Title required', tone: 'partial' };
  if (!descriptionFilled.value)
    return {
      icon: 'ph:article-bold',
      label: 'Description required',
      tone: 'partial',
    };
  return {
    icon: 'ph:rocket-launch-bold',
    label: 'Ready to publish',
    tone: 'ready',
  };
});

const canPublish = computed(
  () =>
    !!selectedFile.value &&
    !!selectedCategoryId.value &&
    !!title.value.trim() &&
    descriptionFilled.value
);

async function upload() {
  if (!canPublish.value || !selectedFile.value) return;
  isUploading.value = true;
  error.value = null;
  try {
    const formData = new FormData();
    formData.append('torrent', selectedFile.value);
    if (selectedCategoryId.value)
      formData.append('categoryId', selectedCategoryId.value);
    if (title.value.trim()) formData.append('name', title.value.trim());
    if (description.value)
      formData.append('description', description.value);
    if (nfoFile.value) formData.append('nfoFile', nfoFile.value);
    if (tags.value.length > 0)
      formData.append('tags', JSON.stringify(tags.value));
    // Only submit IDs when the category supports them — keeps `other`
    // categories (audio/books/etc.) from accidentally storing stray ids.
    if (categoryKindValue.value !== 'other') {
      if (imdbId.value.trim())
        formData.append('imdbId', imdbId.value.trim());
      if (tmdbId.value.trim())
        formData.append('tmdbId', tmdbId.value.trim());
      if (tvdbId.value.trim())
        formData.append('tvdbId', tvdbId.value.trim());
    }

    const response = await $fetch<TorrentResult>('/api/torrents', {
      method: 'POST',
      body: formData,
    });
    result.value = response;
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }; message?: string };
    error.value =
      fetchError.data?.message || fetchError.message || 'Upload failed';
  } finally {
    isUploading.value = false;
  }
}

/**
 * Drop the success panel and clear the per-release fields so the
 * uploader can immediately publish another. The category is intentionally
 * preserved — uploading a multi-part release (e.g. a series episode-by-
 * episode) is the common case. The picker selection is also wiped so the
 * next torrent gets a fresh auto-search.
 */
function resetForm() {
  result.value = null;
  selectedFile.value = null;
  nfoFile.value = null;
  title.value = '';
  description.value = '';
  tags.value = [];
  imdbId.value = '';
  tmdbId.value = '';
  tvdbId.value = '';
  parsed.value = null;
  lookupResult.value = null;
  error.value = null;
  autoTagApplied.value = false;
  if (fileInput.value) fileInput.value.value = '';
  if (nfoInput.value) nfoInput.value.value = '';
  // Bring the user back to the top of the form so the empty drop-zone
  // is the obvious next thing to interact with.
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

useHead({ title: 'Upload torrent' });
</script>

<style scoped>
@import '~/assets/css/upload-form.css';

/* ─── Drop zone ──────────────────────────────────────────────── */
.drop-zone {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  gap: 0.5rem;
  padding: 2.5rem 1.5rem;
  border: 1.5px dashed rgb(var(--line-default));
  border-radius: 0.5rem;
  background: rgb(var(--bg-secondary) / 0.4);
  cursor: pointer;
  transition: all 0.18s ease;
}
.drop-zone:hover,
.drop-zone--dragging {
  border-color: rgb(var(--fg-default) / 0.4);
  background: rgb(var(--fg-default) / 0.04);
}
.drop-zone--filled {
  border-color: rgba(108, 209, 97, 0.45);
  background: rgba(108, 209, 97, 0.05);
  border-style: solid;
}
.drop-zone--small {
  padding: 1rem 1.25rem;
  flex-direction: row;
  text-align: left;
  gap: 0.75rem;
}

.drop-icon {
  width: 3.5rem;
  height: 3.5rem;
  border-radius: 9999px;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.5rem;
  color: rgb(var(--fg-muted));
}
.drop-icon--success {
  background: rgba(108, 209, 97, 0.12);
  border-color: rgba(108, 209, 97, 0.45);
  color: #6cd161;
}
.drop-headline {
  font-size: 0.875rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  margin: 0;
  letter-spacing: 0.02em;
}
.drop-headline code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.2rem;
  padding: 0 0.3rem;
  font-size: 0.75em;
}
.drop-sub {
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  margin: 0;
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}
.drop-clear {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: rgb(var(--fg-muted));
  border: 1px solid rgb(var(--line-default));
  border-radius: 9999px;
  padding: 0.1rem 0.5rem;
  margin-left: 0.5rem;
  transition: all 0.15s;
}
.drop-clear:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.3);
}
.drop-mini-icon {
  font-size: 1.1rem;
  color: rgb(var(--fg-muted));
}
.drop-mini-icon--success {
  color: #6cd161;
}
.drop-mini-name {
  font-size: 0.8rem;
  color: rgb(var(--fg-strong));
  font-weight: 600;
}
.drop-mini-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
}

/* ─── Field hint + required marker ──────────────────────────── */
.field-hint {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  letter-spacing: 0.12em;
  text-transform: none;
  color: rgb(var(--fg-muted));
  margin-left: 0.5rem;
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
.section-help--auto {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: rgb(var(--fg-strong));
  font-weight: 600;
}

/* ─── Aside placeholder (upload-only) ───────────────────────── */
.aside-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.6rem;
  padding: 1.5rem 0.5rem;
  color: rgb(var(--fg-muted));
}
.aside-placeholder-icon {
  font-size: 2rem;
  opacity: 0.5;
}
.aside-placeholder p {
  font-size: 0.75rem;
  line-height: 1.5;
  margin: 0;
}
.aside-divider {
  height: 1px;
  border: 0;
  background: rgb(var(--line-default));
  margin: 0;
}
.aside-progress {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.aside-progress li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.aside-progress li.done {
  color: #6cd161;
  font-weight: 600;
}

/* ─── Result panel (upload-only) ────────────────────────────── */
.result-shell {
  display: flex;
  justify-content: center;
}
.result-card {
  width: 100%;
  max-width: 560px;
  padding: 2rem;
  background: rgb(var(--bg-secondary));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}
.result-success {
  display: flex;
  align-items: flex-start;
  gap: 1rem;
}
.result-icon {
  font-size: 2rem;
  color: #6cd161;
  flex-shrink: 0;
}
.result-success h2 {
  font-size: 1.1rem;
  font-weight: 700;
  margin: 0;
}
.result-success p {
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  margin: 0.25rem 0 0;
}
.result-meta {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.6rem;
  padding: 1rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.375rem;
  margin: 0;
}
.result-meta div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.result-meta dt {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin: 0;
}
.result-meta dd {
  margin: 0;
  font-size: 0.8rem;
  color: rgb(var(--fg-default));
  text-align: right;
  font-weight: 600;
}
.result-meta code {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
}
.result-actions {
  display: flex;
  gap: 0.75rem;
}
.result-actions .btn {
  flex: 1;
  justify-content: center;
}
.result-link {
  align-self: center;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.85rem;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  border-radius: 9999px;
  border: 1px dashed rgb(var(--line-default));
  background: transparent;
  transition: all 0.15s;
}
.result-link:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-default) / 0.4);
  border-style: solid;
}
</style>
