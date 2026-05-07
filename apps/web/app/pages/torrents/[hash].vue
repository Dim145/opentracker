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
            <!-- Category Badge -->
            <div v-if="torrent.category" class="mt-2">
              <span
                class="text-[10px] font-bold bg-bg-tertiary border border-border px-2 py-1 rounded-sm text-text-secondary uppercase tracking-wider"
              >
                {{ torrent.category.name }}
              </span>
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

interface TorrentDetail {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  description: string | null;
  uploaderId: string | null;
  categoryId: string | null;
  category: Category | null;
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
  categoryId: torrent.value?.categoryId || null,
}));

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
</style>
