<script setup lang="ts">
/**
 * Mes alertes, à portée de main.
 *
 * Les recherches enregistrées existent depuis longtemps, mais vivaient dans
 * une page à part. Ici, une pastille par alerte avec le nombre de releases
 * arrivées depuis la dernière fois qu'on l'a ouverte d'ici — et « Enregistrer
 * la recherche courante » pour poser la suivante sans quitter le catalogue.
 */
import { savedSearchLink, type SavedSearchCriteria } from '~/utils/savedSearchLink';

interface SavedSearchItem extends SavedSearchCriteria {
  id: string;
  label: string;
  notify: boolean;
  matchCount: number;
  seenCount?: number;
  lastMatchedAt: string | null;
}

const props = withDefaults(
  defineProps<{
    canSave?: boolean;
    saving?: boolean;
    /** Incrémenté par la page quand une recherche vient d'être enregistrée. */
    version?: number;
  }>(),
  { canSave: false, saving: false, version: 0 },
);
const emit = defineEmits<{ save: [] }>();

const { t } = useI18n();
const { data, refresh } = await useFetch<{ items: SavedSearchItem[]; max: number }>(
  '/api/me/saved-searches',
  { default: () => ({ items: [], max: 20 }) },
);
watch(
  () => props.version,
  () => {
    void refresh();
  },
);

const items = computed(() => data.value?.items ?? []);
const fresh = (s: SavedSearchItem) => Math.max(0, s.matchCount - (s.seenCount ?? 0));

/** Ouvrir, c'est voir : le compteur retombe, sans attendre le serveur. */
function open(s: SavedSearchItem) {
  if (fresh(s) === 0) return;
  s.seenCount = s.matchCount;
  void $fetch(`/api/me/saved-searches/${s.id}/seen`, { method: 'POST' }).catch(() => {
    /* la prochaine ouverture recomptera */
  });
}
</script>

<template>
  <div v-if="items.length || canSave" class="als" :aria-label="t('search.alerts.title')">
    <span class="als-eyebrow">{{ t('search.alerts.title') }}</span>
    <NuxtLink
      v-for="s in items"
      :key="s.id"
      class="al"
      :class="{ 'al--muted': !s.notify }"
      :to="savedSearchLink(s)"
      :title="s.notify ? undefined : t('search.alerts.muted')"
      @click="open(s)"
    >
      <Icon :name="s.notify ? 'ph:bell-fill' : 'ph:bell-slash'" class="al-bell" aria-hidden="true" />
      <span class="al-label">{{ s.label }}</span>
      <span v-if="fresh(s)" class="al-new">{{ t('search.alerts.new', { n: fresh(s) }) }}</span>
    </NuxtLink>
    <button
      v-if="canSave"
      type="button"
      class="al al--add"
      :disabled="saving"
      @click="emit('save')"
    >
      <Icon :name="saving ? 'ph:circle-notch' : 'ph:plus-bold'" :class="{ 'animate-spin': saving }" aria-hidden="true" />
      {{ t('search.alerts.add') }}
    </button>
    <NuxtLink v-if="items.length" to="/alerts" class="als-manage">{{ t('search.alerts.manage') }}</NuxtLink>
  </div>
</template>

<style scoped>
.als {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.4rem;
  margin: 0.9rem 0 0;
}
.als-eyebrow {
  margin-right: 0.25rem;
  font-family: var(--font-mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted) / 1);
}
.al {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  min-height: 1.85rem;
  max-width: 100%;
  padding: 0 0.65rem;
  border: 1px solid rgb(var(--line-default) / 1);
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-surface) / 1);
  font-size: 0.76rem;
  font-weight: 500;
  color: rgb(var(--fg-default) / 1);
  text-decoration: none;
  transition: border-color var(--dur-1) var(--ease-standard);
}
.al:hover {
  border-color: rgb(var(--fg-muted) / 1);
}
.al-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.al-bell {
  flex: none;
  width: 0.75rem;
  height: 0.75rem;
  color: rgb(var(--accent-warm-text) / 1);
}
.al--muted .al-bell {
  color: rgb(var(--fg-faint) / 1);
}
.al-new {
  padding: 0 0.35rem;
  border-radius: var(--radius-pill);
  background: rgb(var(--accent-warm) / 1);
  color: rgb(var(--accent-warm-fg) / 1);
  font-family: var(--font-mono);
  font-size: 0.58rem;
  font-weight: 800;
  line-height: 1.1rem;
}
.al--add {
  border-style: dashed;
  color: rgb(var(--fg-muted) / 1);
}
.al--add:hover {
  color: rgb(var(--fg-strong) / 1);
}
.al--add:disabled {
  opacity: 0.6;
  cursor: progress;
}
.al--add :deep(svg) {
  width: 0.7rem;
  height: 0.7rem;
}
.als-manage {
  margin-left: 0.25rem;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgb(var(--fg-faint) / 1);
}
.als-manage:hover {
  color: rgb(var(--fg-strong) / 1);
}
@media (pointer: coarse) {
  .al {
    min-height: 2.25rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .al {
    transition: none;
  }
}
</style>
