<template>
  <div class="card">
    <div class="card-header">
      <div class="flex items-center gap-2">
        <Icon name="ph:chart-bar" class="text-text-muted" />
        <h3
          class="text-xs font-bold uppercase tracking-wider text-text-primary"
        >
          {{ $t('admin.torznab.stats.title') }}
        </h3>
      </div>
    </div>
    <div class="card-body">
      <!-- Loading State -->
      <div v-if="loading" class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div
          v-for="i in 8"
          :key="i"
          class="bg-bg-tertiary rounded-lg p-4 animate-pulse"
        >
          <div class="h-3 bg-bg-secondary rounded w-20 mb-2"></div>
          <div class="h-6 bg-bg-secondary rounded w-16"></div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.totalRequests') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.totalRequests || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.last24h') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.last24hRequests || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.uniqueUsers') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.uniqueUsers || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.avgResponseTime') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ (stats?.avgResponseTime || 0).toFixed(0)
            }}<span class="text-sm text-text-muted">{{ $t('admin.torznab.stats.responseUnit') }}</span>
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.searchRequests') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.searchRequests || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.tvSearches') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.tvSearchRequests || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.movieSearches') }}
          </p>
          <p class="text-2xl font-bold text-text-primary">
            {{ formatNumber(stats?.movieSearchRequests || 0) }}
          </p>
        </div>

        <div class="bg-bg-tertiary border border-border rounded-lg p-4">
          <p
            class="text-[10px] font-medium uppercase tracking-widest text-text-muted mb-1"
          >
            {{ $t('admin.torznab.stats.errors') }}
          </p>
          <p
            class="text-2xl font-bold"
            :class="stats?.errorsCount ? 'text-red-400' : 'text-text-primary'"
          >
            {{ formatNumber(stats?.errorsCount || 0) }}
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
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

defineProps<{
  stats?: TorznabStats;
  loading?: boolean;
}>();

function formatNumber(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + 'K';
  }
  return num.toString();
}
</script>
