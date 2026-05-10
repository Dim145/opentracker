<template>
  <div class="space-y-4">
    <!-- Time Range Selector -->
    <div class="flex items-center gap-2">
      <span class="text-sm text-text-muted">{{ $t('admin.charts.view') }}</span>
      <div class="flex bg-bg-tertiary rounded-lg p-1 gap-1">
        <button
          v-for="range in timeRanges"
          :key="range.value"
          @click="selectedRange = range.value"
          class="px-3 py-1.5 text-xs font-medium rounded-md transition-all"
          :class="
            selectedRange === range.value
              ? 'bg-fg-default/10 text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          "
        >
          {{ range.label }}
        </button>
      </div>
    </div>

    <!-- Charts Grid -->
    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="bg-bg-secondary p-4 rounded-lg border border-border">
        <h3
          class="text-sm font-bold text-text-primary mb-4 uppercase tracking-wider"
        >
          {{ $t('admin.charts.growthTitle') }}
        </h3>
        <div class="h-64">
          <Line :key="`growth-${mode}`" :data="growthData" :options="chartOptions" />
        </div>
      </div>
      <div class="bg-bg-secondary p-4 rounded-lg border border-border">
        <h3
          class="text-sm font-bold text-text-primary mb-4 uppercase tracking-wider"
        >
          {{ $t('admin.charts.peersTitle') }}
        </h3>
        <div class="h-64">
          <Line :key="`peers-${mode}`" :data="peersData" :options="chartOptions" />
        </div>
      </div>
      <div class="bg-bg-secondary p-4 rounded-lg border border-border">
        <h3
          class="text-sm font-bold text-text-primary mb-4 uppercase tracking-wider"
        >
          {{ $t('admin.charts.redisTitle') }}
        </h3>
        <div class="h-64">
          <Line :key="`redis-${mode}`" :data="redisData" :options="chartOptions" />
        </div>
      </div>
      <div class="bg-bg-secondary p-4 rounded-lg border border-border">
        <h3
          class="text-sm font-bold text-text-primary mb-4 uppercase tracking-wider"
        >
          {{ $t('admin.charts.dbTitle') }}
        </h3>
        <div class="h-64">
          <Line :key="`db-${mode}`" :data="dbData" :options="chartOptions" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Line } from 'vue-chartjs';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

const props = defineProps<{
  history: any[];
}>();

const { t } = useI18n();

type TimeRange = 'hour' | 'day' | 'week' | 'month';

const timeRanges = computed(() => [
  { value: 'hour' as TimeRange, label: t('admin.charts.rangeHour') },
  { value: 'day' as TimeRange, label: t('admin.charts.rangeDay') },
  { value: 'week' as TimeRange, label: t('admin.charts.rangeWeek') },
  { value: 'month' as TimeRange, label: t('admin.charts.rangeMonth') },
]);

const selectedRange = ref<TimeRange>('day');

// Filter history based on selected time range
const filteredHistory = computed(() => {
  const now = Date.now();
  const ranges: Record<TimeRange, number> = {
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };

  const cutoff = now - ranges[selectedRange.value];
  return props.history.filter((h) => new Date(h.createdAt).getTime() >= cutoff);
});

const formatDate = (date: string) => {
  const d = new Date(date);
  if (selectedRange.value === 'hour') {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  if (selectedRange.value === 'day') {
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
  });
};

const { mode } = useColorMode();

function readToken(name: string, fallback: string): string {
  if (!import.meta.client) return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const chartOptions = computed(() => {
  // Reactivity: re-evaluate when theme toggles.
  void mode.value;
  const fg = readToken('--fg-default', '250 250 250');
  const fgMuted = readToken('--fg-muted', '161 161 161');
  const line = readToken('--line-default', '42 42 42');

  return {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: `rgb(${line} / 0.5)` },
        ticks: { color: `rgb(${fgMuted})`, font: { size: 10 } },
      },
      x: {
        grid: { display: false },
        ticks: {
          color: `rgb(${fgMuted})`,
          font: { size: 10 },
          maxTicksLimit: 8,
        },
      },
    },
    plugins: {
      legend: {
        display: true,
        position: 'top' as const,
        labels: {
          color: `rgb(${fg})`,
          font: { size: 11 },
          usePointStyle: true,
        },
      },
      tooltip: {
        mode: 'index' as const,
        intersect: false,
      },
    },
  };
});

const growthData = computed(() => ({
  labels: filteredHistory.value.map((h) => formatDate(h.createdAt)),
  datasets: [
    {
      label: t('admin.charts.users'),
      data: filteredHistory.value.map((h) => h.usersCount),
      borderColor: '#3b82f6',
      backgroundColor: 'rgba(59, 130, 246, 0.1)',
      fill: true,
      tension: 0.4,
    },
    {
      label: t('admin.charts.torrents'),
      data: filteredHistory.value.map((h) => h.torrentsCount),
      borderColor: '#10b981',
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      fill: true,
      tension: 0.4,
    },
  ],
}));

const peersData = computed(() => ({
  labels: filteredHistory.value.map((h) => formatDate(h.createdAt)),
  datasets: [
    {
      label: t('admin.charts.peers'),
      data: filteredHistory.value.map((h) => h.peersCount),
      borderColor: '#f59e0b',
      backgroundColor: 'rgba(245, 158, 11, 0.1)',
      fill: true,
      tension: 0.4,
    },
    {
      label: t('admin.charts.seeders'),
      data: filteredHistory.value.map((h) => h.seedersCount),
      borderColor: '#8b5cf6',
      backgroundColor: 'rgba(139, 92, 246, 0.1)',
      fill: true,
      tension: 0.4,
    },
  ],
}));

const redisData = computed(() => ({
  labels: filteredHistory.value.map((h) => formatDate(h.createdAt)),
  datasets: [
    {
      label: t('admin.charts.redisMemory'),
      data: filteredHistory.value.map((h) =>
        Number((h.redisMemoryUsage / 1024 / 1024).toFixed(2))
      ),
      borderColor: '#ef4444',
      backgroundColor: 'rgba(239, 68, 68, 0.1)',
      fill: true,
      tension: 0.4,
    },
  ],
}));

const dbData = computed(() => ({
  labels: filteredHistory.value.map((h) => formatDate(h.createdAt)),
  datasets: [
    {
      label: t('admin.charts.dbSize'),
      data: filteredHistory.value.map((h) =>
        Number((h.dbSize / 1024 / 1024).toFixed(2))
      ),
      borderColor: '#06b6d4',
      backgroundColor: 'rgba(6, 182, 212, 0.1)',
      fill: true,
      tension: 0.4,
    },
  ],
}));
</script>
