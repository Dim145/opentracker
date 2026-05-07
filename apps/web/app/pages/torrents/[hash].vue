<template>
  <div v-if="torrent">
    <NuxtLink
      to="/torrents"
      class="inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong mb-6 transition-colors"
    >
      <Icon name="ph:arrow-left-bold" />
      Back to index
    </NuxtLink>

    <!-- Torrent Header -->
    <div class="card mb-6 overflow-hidden">
      <div class="card-body !p-6">
        <div
          class="flex flex-col md:flex-row md:items-center justify-between gap-4"
        >
          <div>
            <div class="flex items-center gap-2 mb-1">
              <span
                class="text-[10px] font-bold bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-sm text-text-muted uppercase tracking-wider"
                >Object</span
              >
              <span class="text-[10px] font-mono text-text-muted">{{
                torrent.id
              }}</span>
            </div>
            <h2 class="text-2xl font-bold text-text-primary tracking-tight">
              {{ torrent.name }}
            </h2>
            <!-- Category + Tag Badges -->
            <div
              v-if="torrent.category || torrent.tags?.length"
              class="mt-2 flex flex-wrap items-center gap-2"
            >
              <span
                v-if="torrent.category"
                class="text-[10px] font-bold bg-bg-tertiary border border-border px-2 py-1 rounded-sm text-text-secondary uppercase tracking-wider"
              >
                {{ torrent.category.name }}
              </span>
              <NuxtLink
                v-for="tag in torrent.tags"
                :key="tag.id"
                :to="`/torrents?tag=${encodeURIComponent(tag.slug)}`"
                class="text-[10px] font-bold border px-2 py-1 rounded-sm uppercase tracking-wider hover:opacity-80 transition-opacity flex items-center gap-1.5"
                :style="tagBadgeStyle(tag)"
              >
                <span
                  class="inline-block w-2 h-2 rounded-full"
                  :style="{ backgroundColor: tag.color }"
                />
                {{ tag.name }}
              </NuxtLink>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Edit Button (owner/mod/admin only) -->
            <button
              v-if="canEdit"
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider"
              @click="showEditModal = true"
            >
              <Icon name="ph:pencil-simple-bold" />
              <span>Edit</span>
            </button>
            <!-- Delete Button (owner/mod/admin only) -->
            <button
              v-if="canDelete"
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider text-error hover:bg-error/10"
              @click="confirmDelete"
            >
              <Icon name="ph:trash-bold" />
              <span>Delete</span>
            </button>
            <button
              class="btn btn-secondary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider"
              @click="copyHash"
            >
              <Icon name="ph:copy-bold" />
              <span>Copy Hash</span>
            </button>
            <a
              :href="`/api/torrents/${torrent.infoHash}/download`"
              class="btn btn-primary flex items-center gap-2 !py-2 text-xs font-bold uppercase tracking-wider"
              download
            >
              <Icon name="ph:download-simple-bold" />
              <span>Download</span>
            </a>
          </div>
        </div>

        <div class="mt-6 pt-6 border-t border-border/50 flex flex-wrap gap-6">
          <div class="flex flex-col">
            <span
              class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1"
              >Info Hash</span
            >
            <code
              class="text-xs font-mono text-text-secondary bg-bg-tertiary/50 px-2 py-1 rounded border border-border/50"
            >
              {{ torrent.infoHash }}
            </code>
          </div>
          <div class="flex flex-col">
            <span
              class="text-[10px] font-bold text-text-muted uppercase tracking-widest mb-1"
              >Created At</span
            >
            <div class="flex items-center gap-2">
              <span class="text-xs font-mono text-text-secondary">{{
                formatDate(torrent.createdAt)
              }}</span>
              <span
                class="text-[10px] bg-bg-tertiary border border-border px-1.5 py-0.5 rounded-sm text-text-muted font-bold"
              >
                {{ formatAge(torrent.createdAt) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Stats Grid -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <StatsCard
        title="Seeders"
        :value="torrent.stats.seeders"
        icon="ph:arrow-up-bold"
        variant="success"
      />
      <StatsCard
        title="Leechers"
        :value="torrent.stats.leechers"
        icon="ph:arrow-down-bold"
        variant="warning"
      />
      <StatsCard
        title="Completed"
        :value="torrent.stats.completed"
        icon="ph:check-circle-bold"
      />
      <StatsCard
        title="Total Size"
        :value="formatSize(torrent.size)"
        icon="ph:database-bold"
      />
    </div>

    <!-- Description -->
    <div v-if="torrent.description" class="card mb-6">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:article-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            Description
          </h3>
        </div>
      </div>
      <div class="card-body !p-6">
        <div
          class="prose prose-invert prose-xs max-w-none description-content"
          v-html="renderedDescription"
        ></div>
      </div>
    </div>

    <!-- NFO (collapsed by default — releases can be huge) -->
    <div v-if="torrent.nfo" class="card mb-6">
      <div class="card-header flex items-stretch gap-0 !p-0">
        <button
          type="button"
          class="flex-1 flex items-center gap-2 text-left px-4 py-3 hover:bg-fg-default/5 transition-colors min-w-0"
          :aria-expanded="nfoExpanded"
          aria-controls="nfo-body"
          @click="nfoExpanded = !nfoExpanded"
        >
          <Icon
            name="ph:caret-right-bold"
            class="text-text-muted text-[10px] transition-transform shrink-0"
            :class="{ 'rotate-90': nfoExpanded }"
          />
          <Icon name="ph:scroll-bold" class="text-text-muted shrink-0" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary shrink-0"
          >
            NFO
          </h3>
          <span
            class="text-[10px] text-text-muted font-mono uppercase tracking-widest truncate"
          >
            · {{ nfoMeta }}
          </span>
        </button>
        <button
          v-if="nfoExpanded"
          type="button"
          class="px-4 py-3 border-l border-border text-[10px] font-bold uppercase tracking-widest text-text-muted hover:text-text-strong hover:bg-fg-default/5 transition-colors flex items-center gap-1 shrink-0"
          @click="copyNfo"
        >
          <Icon :name="nfoCopied ? 'ph:check-bold' : 'ph:copy-bold'" />
          {{ nfoCopied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <div v-show="nfoExpanded" id="nfo-body" class="nfo-frame">
        <pre class="nfo-body">{{ torrent.nfo }}</pre>
      </div>
    </div>

    <!-- Peer List -->
    <div class="card">
      <div class="card-header">
        <div class="flex items-center gap-2">
          <Icon name="ph:users-bold" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            Active Swarm ({{ torrent.peers.length }})
          </h3>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="data-table">
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Type</th>
              <th>Uploaded</th>
              <th>Downloaded</th>
              <th class="text-right">Last Seen</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="torrent.peers.length === 0">
              <td
                colspan="5"
                class="text-center text-text-muted py-12 font-mono text-xs uppercase tracking-widest"
              >
                No active peers detected in swarm
              </td>
            </tr>
            <tr v-for="peer in torrent.peers" :key="peer.id">
              <td class="font-mono text-xs">
                <span class="text-text-muted"
                  >{{ peer.id.slice(0, 12) }}...</span
                >
                <span class="text-text-muted">:{{ peer.port }}</span>
              </td>
              <td>
                <span
                  class="stat-badge"
                  :class="peer.isSeeder ? 'stat-seeders' : 'stat-leechers'"
                >
                  <Icon
                    :name="
                      peer.isSeeder ? 'ph:arrow-up-bold' : 'ph:arrow-down-bold'
                    "
                    class="text-[8px]"
                  />
                  {{ peer.isSeeder ? 'Seeder' : 'Leecher' }}
                </span>
              </td>
              <td class="text-text-secondary font-mono text-[10px]">
                {{ formatSize(peer.uploaded) }}
              </td>
              <td class="text-text-secondary font-mono text-[10px]">
                {{ formatSize(peer.downloaded) }}
              </td>
              <td class="text-text-muted font-mono text-[10px] text-right">
                {{ formatAge(peer.lastSeen) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Edit Modal -->
    <EditTorrentModal
      :is-open="showEditModal"
      :torrent="editableTorrent"
      @close="showEditModal = false"
      @saved="handleSaved"
    />

    <!-- Delete confirmation now handled by the shared <ConfirmHost /> via
         useConfirm() — see confirmDelete() below. -->
  </div>
</template>

<script setup lang="ts">

interface Peer {
  id: string;
  port: number;
  isSeeder: boolean;
  uploaded: number;
  downloaded: number;
  lastSeen: string;
}

interface Category {
  id: string;
  name: string;
  slug: string;
}

interface Tag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

interface TorrentDetail {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  description: string | null;
  nfo: string | null;
  uploaderId: string | null;
  categoryId: string | null;
  category: Category | null;
  tags?: Tag[];
  createdAt: string;
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
  peers: Peer[];
}

const route = useRoute();
const hash = route.params.hash as string;

const {
  data: torrent,
  error,
  refresh,
} = await useFetch<TorrentDetail>(`/api/torrents/${hash}`);

// Get current user session
const { loggedIn, user } = useUserSession();
const notifications = useNotificationStore();
const confirm = useConfirm();

// Edit/delete state
const showEditModal = ref(false);

// Compute permissions
const canEdit = computed(() => {
  if (!loggedIn.value || !user.value) return false;
  const isOwner = torrent.value?.uploaderId === user.value.id;
  return isOwner || user.value.isAdmin || user.value.isModerator;
});

const canDelete = computed(() => {
  if (!loggedIn.value || !user.value) return false;
  const isOwner = torrent.value?.uploaderId === user.value.id;
  return isOwner || user.value.isAdmin || user.value.isModerator;
});

// Editable data for modal
const editableTorrent = computed(() => ({
  infoHash: torrent.value?.infoHash || '',
  name: torrent.value?.name || '',
  description: torrent.value?.description || null,
  nfo: torrent.value?.nfo || null,
  categoryId: torrent.value?.categoryId || null,
  tags: torrent.value?.tags ?? [],
}));

function tagBadgeStyle(tag: { color: string }) {
  // Tint the chip background with the tag's color while keeping the
  // foreground readable in either theme. Falls back to neutral on any
  // unparseable input.
  const hex = (tag.color || '').replace('#', '');
  const valid = /^[0-9a-f]{6}$/i.test(hex);
  if (!valid) {
    return {
      backgroundColor: 'rgb(var(--bg-elevated))',
      borderColor: 'rgb(var(--line-default))',
      color: 'rgb(var(--fg-default))',
    };
  }
  return {
    backgroundColor: `#${hex}1a`, // ~10% alpha
    borderColor: `#${hex}66`, // ~40% alpha
    color: 'rgb(var(--fg-default))',
  };
}

const renderedDescription = computed(() =>
  renderMarkdown(torrent.value?.description)
);

if (error.value || !torrent.value) {
  throw createError({ statusCode: 404, message: 'Torrent not found' });
}

async function copyHash() {
  await navigator.clipboard.writeText(torrent.value!.infoHash);
  notifications.success('Info hash copied to clipboard');
}

const nfoCopied = ref(false);
const nfoExpanded = ref(false);
async function copyNfo() {
  if (!torrent.value?.nfo) return;
  await navigator.clipboard.writeText(torrent.value.nfo);
  nfoCopied.value = true;
  setTimeout(() => (nfoCopied.value = false), 1500);
}

const nfoMeta = computed(() => {
  const txt = torrent.value?.nfo;
  if (!txt) return '';
  const lines = txt.split('\n').length;
  const bytes = new Blob([txt]).size;
  const size =
    bytes >= 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${bytes} B`;
  return `${lines} lines · ${size}`;
});

async function confirmDelete() {
  if (!torrent.value) return;
  const ok = await confirm({
    title: 'Delete torrent',
    message: `Permanently remove “${torrent.value.name}” from the index? This cannot be undone.`,
    confirmText: 'Delete',
    destructive: true,
  });
  if (!ok) return;

  try {
    await $fetch(`/api/torrents/${torrent.value!.infoHash}`, {
      method: 'DELETE',
    });
    notifications.success('Torrent deleted');
    navigateTo('/torrents');
  } catch (err: unknown) {
    const fetchError = err as { data?: { message?: string }; message?: string };
    notifications.error(
      fetchError.data?.message ||
        fetchError.message ||
        'Failed to delete torrent'
    );
  }
}

async function handleSaved() {
  // Refresh torrent data
  await refresh();
}
</script>

<style scoped>
.description-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.description-content :deep(p) {
  margin-bottom: 1rem;
}

.description-content :deep(p:last-child) {
  margin-bottom: 0;
}

.description-content :deep(a) {
  color: #fff;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.description-content :deep(ul),
.description-content :deep(ol) {
  margin-bottom: 1rem;
  padding-left: 1.5rem;
}

.description-content :deep(li) {
  margin-bottom: 0.25rem;
}

.nfo-frame {
  background: rgb(var(--bg-inset));
  border-top: 1px solid rgb(var(--line-default));
  padding: 1rem;
  overflow: auto;
  max-height: 70vh;
}

.nfo-body {
  font-family: 'IBM Plex Mono', 'Cascadia Code', Menlo, ui-monospace, monospace;
  font-size: 12px;
  line-height: 1.35;
  color: rgb(var(--fg-default));
  white-space: pre;
  margin: 0;
  tab-size: 4;
  /* NFO ASCII art is visually centered when read in a fixed-width
     terminal — keeping the natural width prevents reflow. */
  width: max-content;
  min-width: 100%;
}
</style>
