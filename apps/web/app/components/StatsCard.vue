<template>
  <div class="card p-3 group">
    <div class="flex items-center gap-3">
      <div
        class="w-10 h-10 rounded bg-bg-tertiary flex items-center justify-center border border-border group-hover:border-fg-default/20 transition-colors"
        :class="{
          'text-success bg-success/5': variant === 'success',
          'text-warning bg-warning/5': variant === 'warning',
          'text-error bg-error/5': variant === 'error',
          'text-text-primary': !variant,
        }"
      >
        <Icon :name="icon || 'ph:chart-bar'" class="text-xl" />
      </div>
      <div class="flex-1 min-w-0">
        <p
          class="text-[10px] text-text-muted uppercase tracking-widest font-bold truncate"
        >
          {{ title }}
        </p>
        <p
          class="text-lg font-mono font-bold mt-0.5 leading-none flex items-baseline gap-2"
          :class="{
            'text-success': variant === 'success',
            'text-warning': variant === 'warning',
            'text-error': variant === 'error',
            'text-text-primary': !variant,
          }"
        >
          <span>{{ typeof value === 'number' ? formatNumber(value) : value }}</span>
          <!-- Optional secondary chip: rendered to the right of the
               primary value in the accent colour so it reads as a
               qualifier rather than a separate KPI. Used on the
               detail page to surface the cross-seed share. -->
          <span
            v-if="sub"
            class="text-[11px] font-mono font-bold text-accent leading-none"
          >
            · {{ sub }}
          </span>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string;
  value: string | number;
  icon?: string;
  variant?: 'success' | 'warning' | 'error';
  /** Optional qualifier shown next to the primary value (e.g. "1 x-seed"). */
  sub?: string;
}>();

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}
</script>
