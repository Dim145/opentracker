<template>
  <!-- Three render branches, in order:
       1. We have an external id and a resolved hit with a poster URL → image.
       2. We have an external id but the lookup is in flight → skeleton.
       3. Anything else (no id, miss, or source disabled) → status icon.
       Branch 1 also covers the "hit but no poster" miss by falling back
       to a broken-image glyph inside the same figure footprint, so the
       layout stays stable across loading → resolved transitions. -->
  <figure
    v-if="externalId && (loading || poster)"
    class="dl-row-poster"
  >
    <img
      v-if="poster?.posterUrl"
      :src="poster.posterUrl"
      :alt="poster.title || item.name"
      loading="lazy"
      decoding="async"
    />
    <Icon
      v-else-if="poster"
      name="ph:image-broken-bold"
      class="dl-row-poster-placeholder"
    />
    <span v-else class="dl-row-poster-skeleton" />
  </figure>
  <div v-else class="dl-row-icon">
    <Icon
      :name="statusIcon"
      :class="statusColor"
    />
  </div>
</template>

<script setup lang="ts">
import type { MediaPoster } from '~/composables/useMediaPosters';

interface Item {
  name: string;
  isHnr: boolean;
  completedAt: string | null;
}

const props = defineProps<{
  item: Item;
  poster: MediaPoster | null;
  loading: boolean;
  externalId: string | null;
}>();

const statusIcon = computed(() => {
  if (props.item.isHnr) return 'ph:warning-bold';
  if (props.item.completedAt) return 'ph:check-circle-fill';
  return 'ph:download-simple-bold';
});

const statusColor = computed(() => {
  if (props.item.isHnr) return 'text-error';
  if (props.item.completedAt) return 'text-success';
  return 'text-text-muted';
});
</script>

<style scoped>
/* Component owns the full visual contract for the cell — same
   dimensions whether we render a poster, a skeleton, or a status
   icon, so the row never reflows. */
.dl-row-poster {
  margin: 0;
  width: 3rem;
  height: 4.5rem;
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  flex-shrink: 0;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dl-row-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  animation: dl-poster-fade 0.3s ease both;
}
@keyframes dl-poster-fade {
  from { opacity: 0; transform: scale(1.02); }
  to   { opacity: 1; transform: scale(1); }
}
.dl-row-poster-placeholder {
  font-size: 1.1rem;
  color: rgb(var(--fg-faint));
}
.dl-row-poster-skeleton {
  position: absolute;
  inset: 0;
  background: linear-gradient(
    100deg,
    rgb(var(--bg-base)) 30%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-base)) 70%
  );
  background-size: 220% 100%;
  animation: dl-shimmer 1.4s ease-in-out infinite;
}
@keyframes dl-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.dl-row-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 2.4rem;
  height: 2.4rem;
  border-radius: 4px;
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-elevated));
  font-size: 1.1rem;
  flex-shrink: 0;
}

@media (max-width: 720px) {
  .dl-row-poster {
    width: 2.5rem;
    height: 3.75rem;
  }
  .dl-row-icon {
    width: 2rem;
    height: 2rem;
    font-size: 0.95rem;
  }
}
</style>
