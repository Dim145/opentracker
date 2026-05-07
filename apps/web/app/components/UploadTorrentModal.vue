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
            <Icon name="ph:upload-simple-bold" class="text-text-muted" />
            <h3
              class="text-xs font-bold uppercase tracking-widest text-text-primary"
            >
              Upload Torrent
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
        <div class="p-6">
          <!-- File Input -->
          <div v-if="!result" class="space-y-6">
            <div
              class="border border-dashed border-border rounded p-10 text-center hover:border-fg-default/30 hover:bg-fg-default/5 transition-all cursor-pointer group"
              :class="{ 'border-success/50 bg-success/5': selectedFile }"
              @click="triggerFileInput"
              @drop.prevent="handleDrop"
              @dragover.prevent
            >
              <input
                ref="fileInput"
                type="file"
                accept=".torrent"
                class="hidden"
                @change="handleFileSelect"
              />
              <div v-if="!selectedFile" class="flex flex-col items-center">
                <div
                  class="w-12 h-12 rounded-full bg-bg-tertiary flex items-center justify-center mb-4 border border-border group-hover:scale-110 transition-transform"
                >
                  <Icon
                    name="ph:file-arrow-up"
                    class="text-2xl text-text-muted"
                  />
                </div>
                <p
                  class="text-xs font-bold uppercase tracking-wider text-text-secondary"
                >
                  Drop .torrent file
                </p>
                <p class="text-[10px] text-text-muted mt-1 font-mono">
                  or click to browse filesystem
                </p>
              </div>
              <div v-else class="flex flex-col items-center">
                <div
                  class="w-12 h-12 rounded-full bg-success/10 flex items-center justify-center mb-4 border border-success/30"
                >
                  <Icon
                    name="ph:check-circle-bold"
                    class="text-2xl text-success"
                  />
                </div>
                <p
                  class="text-xs font-bold text-text-primary truncate max-w-full px-4"
                >
                  {{ selectedFile.name }}
                </p>
                <p class="text-[10px] text-text-muted mt-1 font-mono uppercase">
                  {{ formatSize(selectedFile.size) }}
                </p>
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
                <option value="">Select a category...</option>
                <option v-for="cat in getFlattenedCategories(categories)" :key="cat.id" :value="cat.id">
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
              <TagInput v-model="tags" placeholder="FHD, Full Season, NC…" />
              <p class="text-[10px] text-text-muted ml-1">
                Press Enter or comma to add. Existing tags auto-suggest as you type.
              </p>
            </div>

            <!-- Optional NFO -->
            <div class="space-y-2">
              <label
                class="text-[10px] font-bold uppercase tracking-widest text-text-muted ml-1"
                >NFO (optional)</label
              >
              <div
                class="border border-dashed border-border rounded p-4 text-center hover:border-fg-default/30 hover:bg-fg-default/5 transition-all cursor-pointer"
                :class="{ 'border-success/50 bg-success/5': nfoFile }"
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
                <div
                  v-if="!nfoFile"
                  class="flex flex-col items-center gap-1 text-[10px] text-text-muted"
                >
                  <Icon name="ph:file-text" class="text-lg" />
                  <span class="font-mono uppercase tracking-wider"
                    >Drop or browse a .nfo file</span
                  >
                </div>
                <div
                  v-else
                  class="flex items-center justify-between gap-2 text-left"
                >
                  <div class="flex items-center gap-2 min-w-0">
                    <Icon
                      name="ph:check-circle-bold"
                      class="text-success shrink-0"
                    />
                    <span class="text-xs text-text-primary truncate">{{
                      nfoFile.name
                    }}</span>
                    <span
                      class="text-[10px] text-text-muted font-mono uppercase shrink-0"
                      >{{ formatSize(nfoFile.size) }}</span
                    >
                  </div>
                  <button
                    type="button"
                    class="text-text-muted hover:text-error transition-colors shrink-0"
                    @click.stop="clearNfo"
                  >
                    <Icon name="ph:x-bold" />
                  </button>
                </div>
              </div>
            </div>

            <button
              class="btn btn-primary w-full !py-2.5 flex items-center justify-center gap-2 uppercase tracking-widest font-bold text-xs"
              :disabled="!selectedFile || isUploading"
              @click="upload"
            >
              <Icon
                v-if="isUploading"
                name="ph:circle-notch"
                class="animate-spin"
              />
              <Icon v-else name="ph:rocket-launch-bold" />
              <span>{{
                isUploading ? 'Processing...' : 'Initialize Upload'
              }}</span>
            </button>
          </div>

          <!-- Success Result -->
          <div v-else class="space-y-6">
            <div
              class="bg-success/5 border border-success/20 rounded p-4 flex items-start gap-3"
            >
              <Icon
                name="ph:check-circle-fill"
                class="text-success text-xl shrink-0 mt-0.5"
              />
              <div>
                <p
                  class="text-xs font-bold text-success uppercase tracking-wider"
                >
                  {{ result.message }}
                </p>
                <p class="text-[10px] text-text-muted mt-1 font-mono">
                  The object has been successfully indexed.
                </p>
              </div>
            </div>

            <div
              class="space-y-3 bg-bg-tertiary/30 p-4 rounded border border-border"
            >
              <div class="flex justify-between items-center">
                <span
                  class="text-[10px] font-bold text-text-muted uppercase tracking-widest"
                  >Name</span
                >
                <span
                  class="text-xs font-medium text-text-primary truncate ml-4"
                  >{{ result.data.name }}</span
                >
              </div>
              <div class="flex justify-between items-center">
                <span
                  class="text-[10px] font-bold text-text-muted uppercase tracking-widest"
                  >Hash</span
                >
                <code
                  class="text-[10px] text-text-secondary font-mono bg-bg-primary px-1.5 py-0.5 rounded border border-border"
                  >{{ result.data.infoHash.slice(0, 12) }}...</code
                >
              </div>
              <div class="flex justify-between items-center">
                <span
                  class="text-[10px] font-bold text-text-muted uppercase tracking-widest"
                  >Size</span
                >
                <span class="text-xs font-mono text-text-primary">{{
                  formatSize(result.data.size)
                }}</span>
              </div>
            </div>

            <div class="flex gap-2">
              <button
                class="btn btn-secondary flex-1 text-[10px] font-bold uppercase tracking-widest"
                @click="close"
              >
                Close
              </button>
              <button
                class="btn btn-primary flex-1 text-[10px] font-bold uppercase tracking-widest"
                @click="navigateTo(`/torrents/${result.data.infoHash}`)"
              >
                View Details
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">

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

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  close: [];
  uploaded: [];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const nfoInput = ref<HTMLInputElement | null>(null);
const selectedFile = ref<File | null>(null);
const nfoFile = ref<File | null>(null);
const selectedCategoryId = ref('');
const description = ref('');
const tags = ref<string[]>([]);
const isUploading = ref(false);
const result = ref<TorrentResult | null>(null);
const error = ref<string | null>(null);
const copied = ref(false);
const NFO_MAX_BYTES = 256 * 1024;

const { data: categories } = await useFetch('/api/categories');

function getFlattenedCategories(
  categories: Array<{ id: string; name: string; subcategories?: any[] }>,
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
  // Reset state after animation
  setTimeout(reset, 200);
}

function reset() {
  selectedFile.value = null;
  nfoFile.value = null;
  selectedCategoryId.value = '';
  description.value = '';
  tags.value = [];
  result.value = null;
  error.value = null;
  copied.value = false;
}

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
  const file = e.dataTransfer?.files?.[0];
  if (file && file.name.endsWith('.torrent')) {
    selectedFile.value = file;
    error.value = null;
  } else {
    error.value = 'Please drop a .torrent file';
  }
}

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

async function upload() {
  if (!selectedFile.value) return;

  isUploading.value = true;
  error.value = null;

  try {
    const formData = new FormData();
    formData.append('torrent', selectedFile.value);
    if (selectedCategoryId.value) {
      formData.append('categoryId', selectedCategoryId.value);
    }
    if (description.value) {
      formData.append('description', description.value);
    }
    if (nfoFile.value) {
      formData.append('nfoFile', nfoFile.value);
    }
    if (tags.value.length > 0) {
      // Send as JSON. The endpoint distinguishes UUIDs (admin pre-resolved
      // ids) from free-form names and auto-creates the latter.
      formData.append('tags', JSON.stringify(tags.value));
    }

    const response = await $fetch<TorrentResult>('/api/torrents', {
      method: 'POST',
      body: formData,
    });

    result.value = response;
    emit('uploaded');
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }; message?: string };
    error.value =
      fetchError.data?.message || fetchError.message || 'Upload failed';
  } finally {
    isUploading.value = false;
  }
}

async function copyMagnet() {
  if (!result.value?.data.magnetLink) return;

  try {
    await navigator.clipboard.writeText(result.value.data.magnetLink);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    error.value = 'Failed to copy to clipboard';
  }
}

</script>

