<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      @click.self="close"
    >
      <div
        class="bg-bg-secondary border border-border rounded shadow-2xl w-full max-w-md mx-4 overflow-hidden"
      >
        <!-- Header -->
        <div
          class="flex items-center justify-between px-4 py-3 border-b border-border bg-bg-tertiary/50"
        >
          <div class="flex items-center gap-2">
            <Icon name="ph:pencil-simple-bold" class="text-text-muted" />
            <h3
              class="text-xs font-bold uppercase tracking-widest text-text-primary"
            >
              Edit Torrent
            </h3>
          </div>
          <button
            class="text-text-muted hover:text-text-strong transition-colors"
            @click="close"
          >
            <Icon name="ph:x-bold" />
          </button>
        </div>

        <!-- Body -->
        <div class="p-6 space-y-6">
          <!-- Torrent Name (read-only) -->
          <div class="space-y-2">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted ml-1"
              >Torrent Name</label
            >
            <div
              class="input w-full !py-2 text-xs font-medium bg-bg-tertiary/50 text-text-secondary cursor-not-allowed"
            >
              {{ torrent.name }}
            </div>
          </div>

          <!-- Category Select -->
          <div class="space-y-2">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted ml-1"
              >Category</label
            >
            <select
              v-model="selectedCategoryId"
              class="input w-full !py-2 text-xs font-bold uppercase tracking-wider"
            >
              <option value="">No category</option>
              <option
                v-for="cat in getFlattenedCategories(categories || [])"
                :key="cat.id"
                :value="cat.id"
              >
                {{ cat.name }}
              </option>
            </select>
          </div>

          <!-- Description -->
          <div class="space-y-2">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted ml-1"
              >Description</label
            >
            <WysiwygEditor
              v-model="description"
              format="markdown"
              placeholder="Describe the release. Paste BBCode, HTML or Markdown — it all converts."
            />
          </div>

          <!-- Tags -->
          <div class="space-y-2">
            <label
              class="text-[10px] font-bold uppercase tracking-widest text-text-muted ml-1"
              >Tags</label
            >
            <TagInput v-model="tagNames" placeholder="FHD, Full Season, NC…" />
          </div>

          <!-- NFO -->
          <div class="space-y-2">
            <div class="flex items-center justify-between ml-1">
              <label
                class="text-[10px] font-bold uppercase tracking-widest text-text-muted"
                >NFO</label
              >
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  class="text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong transition-colors"
                  @click="triggerNfoInput"
                >
                  Upload .nfo
                </button>
                <button
                  v-if="nfo"
                  type="button"
                  class="text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-error transition-colors"
                  @click="nfo = ''"
                >
                  Clear
                </button>
              </div>
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
              rows="6"
              class="input w-full !py-2 text-[11px] resize-none nfo-textarea"
              placeholder="Paste or upload an NFO release file…"
            ></textarea>
          </div>

          <!-- Error Message -->
          <div
            v-if="error"
            class="bg-error/10 border border-error/20 rounded p-3 flex items-start gap-2"
          >
            <Icon
              name="ph:warning-circle-fill"
              class="text-error text-lg shrink-0 mt-0.5"
            />
            <p class="text-xs text-error">{{ error }}</p>
          </div>

          <!-- Actions -->
          <div class="flex gap-2">
            <button
              class="btn btn-secondary flex-1 text-[10px] font-bold uppercase tracking-widest"
              :disabled="isSaving"
              @click="close"
            >
              Cancel
            </button>
            <button
              class="btn btn-primary flex-1 text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2"
              :disabled="isSaving"
              @click="save"
            >
              <Icon
                v-if="isSaving"
                name="ph:circle-notch"
                class="animate-spin"
              />
              <span>{{ isSaving ? 'Saving...' : 'Save Changes' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">

interface Category {
  id: string;
  name: string;
  subcategories?: Category[];
}

interface TorrentData {
  infoHash: string;
  name: string;
  description: string | null;
  nfo: string | null;
  categoryId: string | null;
  tags?: Array<{ id: string; name: string; slug: string; color: string }>;
}

const props = defineProps<{
  isOpen: boolean;
  torrent: TorrentData;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

const nfoInput = ref<HTMLInputElement | null>(null);
const selectedCategoryId = ref('');
const description = ref('');
const nfo = ref('');
const tagNames = ref<string[]>([]);
const isSaving = ref(false);
const error = ref<string | null>(null);
const NFO_MAX_BYTES = 256 * 1024;

const { data: categories } = await useFetch<Category[]>('/api/categories');

// Initialize form data when torrent prop changes
watch(
  () => props.torrent,
  (torrent) => {
    if (torrent) {
      selectedCategoryId.value = torrent.categoryId || '';
      description.value = torrent.description || '';
      nfo.value = torrent.nfo || '';
      tagNames.value = torrent.tags?.map((t) => t.name) ?? [];
    }
  },
  { immediate: true }
);

// Reset form when modal opens
watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen && props.torrent) {
      selectedCategoryId.value = props.torrent.categoryId || '';
      description.value = props.torrent.description || '';
      nfo.value = props.torrent.nfo || '';
      tagNames.value = props.torrent.tags?.map((t) => t.name) ?? [];
      error.value = null;
    }
  }
);

function getFlattenedCategories(
  categories: Category[],
  prefix = ''
): Array<{ id: string; name: string }> {
  let result: Array<{ id: string; name: string }> = [];

  for (const category of categories) {
    result.push({ id: category.id, name: prefix + category.name });

    if (category.subcategories) {
      result = result.concat(
        getFlattenedCategories(category.subcategories, prefix + '╚=> ')
      );
    }
  }

  return result;
}

function close() {
  emit('close');
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
  isSaving.value = true;
  error.value = null;

  try {
    await fetch(`/api/torrents/${props.torrent.infoHash}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        description: description.value,
        categoryId: selectedCategoryId.value || null,
        nfo: nfo.value,
      }),
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to save changes');
      }
      return res.json();
    });

    // Tags are kept in their own endpoint so the picker can persist
    // independently of the description/category edit. Send the full set
    // of names; the API resolves/creates as needed and replaces the
    // torrent's tag links atomically.
    await fetch(`/api/torrents/${props.torrent.infoHash}/tags`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tags: tagNames.value }),
    }).then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to save tags');
      }
    });

    emit('saved');
    close();
  } catch (err: unknown) {
    const fetchError = err as { message?: string };
    error.value = fetchError.message || 'Failed to save changes';
  } finally {
    isSaving.value = false;
  }
}
</script>

<style scoped>
.nfo-textarea {
  font-family: 'IBM Plex Mono', 'Cascadia Code', Menlo, ui-monospace, monospace;
  white-space: pre;
  overflow-x: auto;
  tab-size: 4;
}
</style>
