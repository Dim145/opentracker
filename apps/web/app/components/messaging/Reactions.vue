<template>
  <!--
    The counts under a message — and nothing at all when there are none.
    The wrapper used to render either way, reserving its height on every
    line and leaving a band of empty space under messages nobody had
    reacted to. The "add" trigger lives in the hover toolbar instead.
  -->
  <div v-if="visible.length" class="rx">
    <button
      v-for="key in visible"
      :key="key"
      type="button"
      class="rx-chip"
      :class="{ 'rx-chip--mine': mine.includes(key) }"
      :aria-pressed="mine.includes(key)"
      :aria-label="$t(`messaging.reactions.${key}`)"
      :title="$t(`messaging.reactions.${key}`)"
      @click="emit('toggle', key)"
    >
      <span class="rx-glyph" aria-hidden="true">{{ REACTION_GLYPH[key] }}</span>
      <span class="rx-count">{{ counts[key] }}</span>
    </button>
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  /** key → count. Absent keys are zero. */
  counts: Record<string, number>;
  /** Keys this reader used. */
  mine: string[];
}>();

const emit = defineEmits<{ (e: 'toggle', key: string): void }>();

const visible = computed(() =>
  REACTION_KEYS.filter((k) => (props.counts[k] ?? 0) > 0)
);
</script>

<style scoped>
.rx {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  margin-top: 0.3rem;
}
.rx-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-height: 1.5rem;
  padding: 0.15rem 0.4rem;
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-default));
  font-size: 0.75rem;
  line-height: 1;
  cursor: pointer;
  transition: background var(--dur-2) ease, border-color var(--dur-2) ease;
}
.rx-chip:hover { background: rgb(var(--fg-default) / 0.08); }
.rx-chip--mine {
  border-color: rgb(var(--accent-warm));
  background: rgb(var(--accent-warm) / 0.12);
}
.rx-glyph { font-size: 0.85rem; }
.rx-count {
  font-family: var(--font-mono);
  font-size: 0.65rem;
  font-weight: 700;
}
@media (prefers-reduced-motion: reduce) {
  .rx-chip { transition: none; }
}
</style>
