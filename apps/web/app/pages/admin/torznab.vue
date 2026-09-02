<template>
  <div class="space-y-6">
    <!-- Stats Overview -->
    <AdminTorznabStats :stats="data?.stats" :loading="pending" />

    <!-- Configuration -->
    <AdminTorznabConfig
      :config="data?.config"
      :loading="pending"
      @update="handleConfigUpdate"
    />

    <!-- Rate Limiting -->
    <AdminTorznabRateLimiting
      :config="data?.config"
      :loading="pending"
      @update="handleConfigUpdate"
    />

    <!-- API Users -->
    <AdminTorznabUsers />

    <!-- Request Logs -->
    <AdminTorznabLogs />

    <!-- Blacklist -->
    <AdminTorznabBlacklist />
  </div>
</template>

<script setup lang="ts">
interface TorznabConfig {
  enabled: boolean;
  rateLimitSearch: number;
  rateLimitDownload: number;
  rateLimitWindow: number;
  enableLogging: boolean;
  allowedCategories: string[];
  includeFederated: boolean;
}

interface TorznabStats {
  totalRequests: number;
  searchRequests: number;
  downloadRequests: number;
  capsRequests: number;
  tvSearchRequests: number;
  movieSearchRequests: number;
  errorsCount: number;
  uniqueUsers: number;
  avgResponseTime: number;
  last24hRequests: number;
}

interface TorznabData {
  config: TorznabConfig;
  stats: TorznabStats;
}

const { data, pending, refresh } =
  await useFetch<TorznabData>('/api/admin/torznab');

const { t } = useI18n();
const notifications = useNotificationStore();

async function handleConfigUpdate(updates: Partial<TorznabConfig>) {
  // Un `console.error` n'est pas un retour d'interface. Les interrupteurs sont
  // liés à la prop, donc rien ne bouge à l'écran pendant l'aller-retour ni
  // après un échec : couper l'API Torznab produisait exactement la même absence
  // de signal que de ne rien faire. Et `refresh()` n'était pas atteint en cas
  // d'échec, donc l'état affiché restait celui d'avant sans que personne ne le
  // dise.
  try {
    await $fetch('/api/admin/torznab', {
      method: 'PUT',
      body: updates,
    });
    notifications.success(t('common.saved'));
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } };
    notifications.error(e?.data?.message || t('common.saveFailed'));
  } finally {
    await refresh();
  }
}
</script>
