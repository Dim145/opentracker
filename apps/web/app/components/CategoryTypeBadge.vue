<template>
  <!-- Tiny operator-facing chip that surfaces a category's canonical
       media type. Rendered next to the slug in the admin Categories
       tree so the operator can audit at a glance which rows opt into
       /movie vs /tv on the upload form. Hidden when the type is null
       (i.e. the heuristic decides). -->
  <span
    v-if="type === 'movie' || type === 'tv' || type === 'game'"
    class="type-badge"
    :class="`type-badge--${type}`"
  >
    <Icon
      :name="
        type === 'movie'
          ? 'ph:film-strip-fill'
          : type === 'tv'
            ? 'ph:television-fill'
            : 'ph:game-controller-fill'
      "
      class="type-badge__icon"
    />
    {{ type }}
  </span>
</template>

<script setup lang="ts">
defineProps<{
  type?: 'movie' | 'tv' | 'game' | null;
}>();
</script>

<style scoped>
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.05rem 0.4rem;
  border-radius: 0.2rem;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  line-height: 1.45;
}
.type-badge__icon {
  font-size: 10px;
}
/* Two distinct accents — gold for /movie, cyan for /tv — match the
   palette used in the admin KPI cards elsewhere in the app. */
.type-badge--movie {
  color: #f5c518;
  border-color: rgba(245, 197, 24, 0.4);
  background: rgba(245, 197, 24, 0.08);
}
.type-badge--tv {
  color: #34d4d8;
  border-color: rgba(52, 212, 216, 0.4);
  background: rgba(52, 212, 216, 0.08);
}
.type-badge--game {
  color: #a78bfa;
  border-color: rgba(167, 139, 250, 0.4);
  background: rgba(167, 139, 250, 0.08);
}
</style>
