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

async function handleConfigUpdate(updates: Partial<TorznabConfig>) {
  try {
    await $fetch('/api/admin/torznab', {
      method: 'PUT',
      body: updates,
    });
    await refresh();
  } catch (error) {
    console.error('Failed to update Torznab config:', error);
  }
}
</script>
