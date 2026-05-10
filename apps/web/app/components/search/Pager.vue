<template>
  <!-- Compact paginator — used both at the top and bottom of the search
       results. The visible window is 5 page numbers around the current
       page, with first/last and prev/next anchors when there's enough
       room. On phones we collapse to first / prev / current / next /
       last so the strip never wraps. -->
  <nav class="pager" :aria-label="$t('search.pager.pagination')">
    <button
      type="button"
      class="pager-btn pager-btn--icon"
      :disabled="page <= 1"
      :aria-label="$t('admin.bannedIps.pager.firstPage')"
      @click="$emit('go', 1)"
    >
      <Icon name="ph:caret-double-left-bold" />
    </button>
    <button
      type="button"
      class="pager-btn pager-btn--icon"
      :disabled="page <= 1"
      :aria-label="$t('search.pager.previousPage')"
      @click="$emit('go', page - 1)"
    >
      <Icon name="ph:caret-left-bold" />
    </button>

    <button
      v-for="p in window"
      :key="p"
      type="button"
      class="pager-btn"
      :class="{ 'pager-btn--on': p === page }"
      :aria-current="p === page ? 'page' : undefined"
      @click="$emit('go', p)"
    >
      {{ p }}
    </button>

    <button
      type="button"
      class="pager-btn pager-btn--icon"
      :disabled="page >= pages"
      :aria-label="$t('search.pager.nextPage')"
      @click="$emit('go', page + 1)"
    >
      <Icon name="ph:caret-right-bold" />
    </button>
    <button
      type="button"
      class="pager-btn pager-btn--icon"
      :disabled="page >= pages"
      :aria-label="$t('admin.bannedIps.pager.lastPage')"
      @click="$emit('go', pages)"
    >
      <Icon name="ph:caret-double-right-bold" />
    </button>
  </nav>
</template>

<script setup lang="ts">
const props = defineProps<{
  page: number;
  pages: number;
}>();

defineEmits<{
  go: [page: number];
}>();

// Compute a 5-page window centred on the current page, clamped to [1, pages].
// We avoid an even-sized window because the eye lands on the middle slot
// faster when there's a clear centre.
const window = computed<number[]>(() => {
  const total = props.pages;
  if (total <= 0) return [];
  const size = 5;
  let start = Math.max(1, props.page - Math.floor(size / 2));
  let end = Math.min(total, start + size - 1);
  start = Math.max(1, end - size + 1);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
});
</script>

<style scoped>
.pager {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  flex-wrap: wrap;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  height: 2rem;
  padding: 0 0.55rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.12s;
}
.pager-btn:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
  background: rgb(var(--bg-elevated));
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager-btn--on {
  background: rgb(var(--fg-strong));
  color: rgb(var(--accent-fg));
  border-color: rgb(var(--fg-strong));
}
.pager-btn--on:hover:not(:disabled) {
  background: rgb(var(--fg-default));
  color: rgb(var(--accent-fg));
}
.pager-btn--icon {
  padding: 0 0.45rem;
}

/* On narrow viewports the page-number window collapses so only first /
   prev / current / next / last are visible — that's already at most 5
   buttons, which fits a 360 px row without wrapping. */
@media (max-width: 640px) {
  .pager-btn:not(.pager-btn--on):not(.pager-btn--icon) {
    display: none;
  }
}
</style>
