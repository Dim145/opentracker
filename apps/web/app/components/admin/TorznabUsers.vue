<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2">
          <Icon name="ph:users" class="text-text-muted" />
          <h3
            class="text-xs font-bold uppercase tracking-wider text-text-primary"
          >
            {{ $t('admin.torznab.users.title') }}
          </h3>
        </div>
        <button
          @click="() => refresh()"
          :disabled="loading"
          class="p-1.5 bg-bg-tertiary border border-border rounded hover:border-fg-default/20 transition-colors"
          :title="$t('admin.torznab.users.refreshTitle')"
        >
          <Icon
            name="ph:arrows-clockwise"
            :class="['text-text-muted text-sm', loading && 'animate-spin']"
          />
        </button>
      </div>
    </div>
    <div class="card-body">
      <!-- Search -->
      <div class="flex items-center gap-3 mb-4">
        <div class="relative flex-1">
          <Icon
            name="ph:magnifying-glass"
            class="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted text-sm"
          />
          <input
            v-model="search"
            type="text"
            :placeholder="$t('admin.torznab.users.searchPlaceholder')"
            class="w-full bg-bg-tertiary border border-border rounded pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-fg-default/20"
          />
        </div>
      </div>

      <!-- Users Table -->
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-border">
              <th
                class="text-left text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.user') }}
              </th>
              <th
                class="text-left text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.passkey') }}
              </th>
              <th
                class="text-center text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.requests') }}
              </th>
              <th
                class="text-center text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.rateLimits') }}
              </th>
              <th
                class="text-left text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.lastRequest') }}
              </th>
              <th
                class="text-right text-[10px] font-bold uppercase tracking-widest text-text-muted py-2 px-2"
              >
                {{ $t('admin.torznab.users.actions') }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-if="loading"
              v-for="i in 5"
              :key="i"
              class="border-b border-border/50"
            >
              <td colspan="6" class="py-3 px-2">
                <div class="h-4 bg-bg-tertiary rounded animate-pulse"></div>
              </td>
            </tr>
            <tr
              v-else
              v-for="user in filteredUsers"
              :key="user.id"
              class="border-b border-border/50 hover:bg-bg-tertiary/50 transition-colors"
            >
              <td class="py-3 px-2">
                <NuxtLink
                  :to="`/users/${user.username}`"
                  class="text-sm font-medium text-text-primary hover:underline"
                >
                  {{ user.username }}
                </NuxtLink>
              </td>
              <td class="py-3 px-2">
                <code
                  class="text-[11px] font-mono text-text-muted bg-bg-tertiary px-1.5 py-0.5 rounded"
                >
                  {{ user.passkeyMasked }}
                </code>
              </td>
              <td class="py-3 px-2 text-center">
                <span class="text-sm text-text-primary">
                  {{ user.apiStats?.totalRequests || 0 }}
                </span>
              </td>
              <td class="py-3 px-2 text-center">
                <span
                  v-if="(user.apiStats?.rateLimitHits || 0) > 0"
                  class="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/20 text-yellow-400"
                >
                  {{ $t('admin.torznab.users.rateLimitHits', { n: user.apiStats?.rateLimitHits }) }}
                </span>
                <span v-else class="text-xs text-text-muted">—</span>
              </td>
              <td class="py-3 px-2">
                <span class="text-xs text-text-muted">
                  {{
                    user.apiStats?.lastRequest
                      ? formatRelativeTime(user.apiStats.lastRequest)
                      : $t('admin.torznab.users.never')
                  }}
                </span>
              </td>
              <td class="py-3 px-2">
                <div class="flex items-center justify-end gap-1">
                  <button
                    @click="showUserLogs(user)"
                    class="p-1.5 text-text-muted hover:text-text-primary hover:bg-bg-tertiary rounded transition-colors"
                    :title="$t('admin.torznab.users.viewLogsTitle')"
                  >
                    <Icon name="ph:list" class="text-sm" />
                  </button>
                  <button
                    @click="confirmResetPasskey(user)"
                    class="p-1.5 text-text-muted hover:text-yellow-400 hover:bg-bg-tertiary rounded transition-colors"
                    :title="$t('admin.torznab.users.resetPasskeyTitle')"
                  >
                    <Icon name="ph:key" class="text-sm" />
                  </button>
                  <button
                    @click="confirmBlockUser(user)"
                    class="p-1.5 text-text-muted hover:text-red-400 hover:bg-bg-tertiary rounded transition-colors"
                    :title="$t('admin.torznab.users.blockApiTitle')"
                  >
                    <Icon name="ph:prohibit" class="text-sm" />
                  </button>
                </div>
              </td>
            </tr>
            <tr v-if="!loading && filteredUsers.length === 0">
              <td colspan="6" class="py-8 text-center text-text-muted text-sm">
                {{ $t('admin.torznab.users.empty') }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Pagination -->
      <div
        v-if="data?.total && data.total > limit"
        class="flex items-center justify-between mt-4 pt-4 border-t border-border"
      >
        <span class="text-xs text-text-muted">
          {{ $t('admin.torznab.users.showing', { from: offset + 1, to: Math.min(offset + limit, data.total), total: data.total }) }}
        </span>
        <div class="flex items-center gap-2">
          <button
            @click="prevPage"
            :disabled="offset === 0"
            class="px-3 py-1 bg-bg-tertiary border border-border rounded text-xs disabled:opacity-50 hover:border-fg-default/20 transition-colors"
          >
            {{ $t('admin.torznab.users.previous') }}
          </button>
          <button
            @click="nextPage"
            :disabled="offset + limit >= data.total"
            class="px-3 py-1 bg-bg-tertiary border border-border rounded text-xs disabled:opacity-50 hover:border-fg-default/20 transition-colors"
          >
            {{ $t('admin.torznab.users.next') }}
          </button>
        </div>
      </div>
    </div>

    <!-- User Logs Modal -->
    <Teleport to="body">
      <div
        v-if="selectedUser"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div class="fixed inset-0 bg-black/80" @click="selectedUser = null" />
        <div
          class="relative bg-bg-primary border border-border rounded-lg w-full max-w-3xl max-h-[80vh] overflow-hidden"
        >
          <div
            class="flex items-center justify-between p-4 border-b border-border"
          >
            <h3 class="text-sm font-bold text-text-primary">
              {{ $t('admin.torznab.users.logsTitle', { username: selectedUser.username }) }}
            </h3>
            <button
              @click="selectedUser = null"
              class="text-text-muted hover:text-text-primary"
            >
              <Icon name="ph:x" />
            </button>
          </div>
          <div class="p-4 overflow-y-auto max-h-[60vh]">
            <AdminTorznabLogTable
              :logs="userLogs"
              :loading="loadingLogs"
              compact
            />
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Confirm Modal -->
    <Teleport to="body">
      <div
        v-if="confirmAction"
        class="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div class="fixed inset-0 bg-black/80" @click="confirmAction = null" />
        <div
          class="relative bg-bg-primary border border-border rounded-lg w-full max-w-md p-6"
        >
          <h3 class="text-lg font-bold text-text-primary mb-2">
            {{ confirmAction.title }}
          </h3>
          <p class="text-sm text-text-muted mb-4">
            {{ confirmAction.message }}
          </p>
          <div class="flex items-center justify-end gap-3">
            <button
              @click="confirmAction = null"
              class="px-4 py-2 bg-bg-tertiary border border-border rounded text-sm hover:border-fg-default/20 transition-colors"
            >
              {{ $t('admin.torznab.users.cancel') }}
            </button>
            <button
              @click="executeAction"
              :disabled="actionLoading"
              class="px-4 py-2 rounded text-sm font-medium flex items-center gap-2"
              :class="
                confirmAction.variant === 'danger'
                  ? 'bg-red-500 text-white'
                  : 'bg-yellow-500 text-black'
              "
            >
              <Icon
                v-if="actionLoading"
                name="ph:circle-notch"
                class="animate-spin"
              />
              {{ confirmAction.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();

interface ApiStats {
  totalRequests: number;
  searchRequests: number;
  downloadRequests: number;
  lastRequest: number;
  rateLimitHits: number;
}

interface TorznabUser {
  id: string;
  username: string;
  passkeyMasked: string;
  lastSeen: string;
  createdAt: string;
  apiStats: ApiStats | null;
}

interface ConfirmAction {
  title: string;
  message: string;
  confirmText: string;
  variant: 'danger' | 'warning';
  action: () => Promise<void>;
}

const limit = 20;
const offset = ref(0);
const search = ref('');
const selectedUser = ref<TorznabUser | null>(null);
const userLogs = ref<any[]>([]);
const loadingLogs = ref(false);
const confirmAction = ref<ConfirmAction | null>(null);
const actionLoading = ref(false);

const {
  data,
  pending: loading,
  refresh,
} = await useFetch<{
  users: TorznabUser[];
  total: number;
}>('/api/admin/torznab/users', {
  query: computed(() => ({ limit, offset: offset.value })),
});

const filteredUsers = computed(() => {
  if (!data.value?.users) return [];
  if (!search.value) return data.value.users;

  const query = search.value.toLowerCase();
  return data.value.users.filter(
    (user) =>
      user.username.toLowerCase().includes(query) ||
      user.passkeyMasked.toLowerCase().includes(query)
  );
});

function prevPage() {
  offset.value = Math.max(0, offset.value - limit);
}

function nextPage() {
  offset.value += limit;
}

async function showUserLogs(user: TorznabUser) {
  selectedUser.value = user;
  loadingLogs.value = true;
  try {
    const response = await $fetch<{ logs: any[] }>('/api/admin/torznab/logs', {
      query: { userId: user.id },
    });
    userLogs.value = response.logs;
  } catch (error) {
    console.error('Failed to load user logs:', error);
  } finally {
    loadingLogs.value = false;
  }
}

function confirmResetPasskey(user: TorznabUser) {
  confirmAction.value = {
    title: t('admin.torznab.users.resetPasskeyTitle2'),
    message: t('admin.torznab.users.resetPasskeyMessage', { username: user.username }),
    confirmText: t('admin.torznab.users.resetPasskeyConfirm'),
    variant: 'warning',
    action: async () => {
      await $fetch(`/api/admin/torznab/users/${user.id}/reset`, {
        method: 'POST',
      });
      await refresh();
    },
  };
}

function confirmBlockUser(user: TorznabUser) {
  confirmAction.value = {
    title: t('admin.torznab.users.blockUserTitle'),
    message: t('admin.torznab.users.blockUserMessage', { username: user.username }),
    confirmText: t('admin.torznab.users.blockUserConfirm'),
    variant: 'danger',
    action: async () => {
      await $fetch(`/api/admin/torznab/users/${user.id}/block`, {
        method: 'POST',
        body: { block: true, reason: t('admin.torznab.users.blockReason') },
      });
      await refresh();
    },
  };
}

async function executeAction() {
  if (!confirmAction.value) return;
  actionLoading.value = true;
  try {
    await confirmAction.value.action();
    confirmAction.value = null;
  } catch (error) {
    console.error('Action failed:', error);
  } finally {
    actionLoading.value = false;
  }
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return t('admin.torznab.users.justNow');
  if (seconds < 3600) return t('admin.torznab.users.minutesAgo', { n: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('admin.torznab.users.hoursAgo', { n: Math.floor(seconds / 3600) });
  return t('admin.torznab.users.daysAgo', { n: Math.floor(seconds / 86400) });
}
</script>
