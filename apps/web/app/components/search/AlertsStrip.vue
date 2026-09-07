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
    /** Dans le rail : en colonne, avec l'en-tête des facettes. */
    rail?: boolean;
  }>(),
  { canSave: false, saving: false, version: 0, rail: false },
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
/** Dans le rail, cinq au plus : au-delà, la colonne des filtres deviendrait celle des alertes. « Gérer » porte le reste. */
const RAIL_MAX = 5;
const shown = computed(() => (props.rail ? items.value.slice(0, RAIL_MAX) : items.value));
const hidden = computed(() => items.value.length - shown.value.length);
const fresh = (s: SavedSearchItem) => Math.max(0, s.matchCount - (s.seenCount ?? 0));

/** Ouvrir, c'est voir : le compteur retombe, sans attendre le serveur. */
function open(s: SavedSearchItem) {
  if (fresh(s) === 0) return;
  // La charge utile de `useFetch` n'est pas réactive en profondeur : on la
  // remplace, sinon le badge « nouv. » attend un rendu qui ne vient pas.
  if (data.value) {
    data.value = { ...data.value, items: data.value.items.map((it) => (it.id === s.id ? { ...it, seenCount: it.matchCount } : it)) };
  }
  void $fetch(`/api/me/saved-searches/${s.id}/seen`, { method: 'POST' }).catch(() => {
    /* la prochaine ouverture recomptera */
  });
}
</script>

<template>
  <section v-if="items.length || canSave" class="als" :class="{ 'als--rail': rail }" :aria-label="t('search.alerts.title')">
    <h3 class="als-eyebrow">{{ t('search.alerts.title') }}</h3>
    <NuxtLink
      v-for="s in shown"
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
    <NuxtLink v-if="items.length" to="/alerts" class="als-manage">
      {{ hidden > 0 ? t('search.alerts.manageMore', { n: hidden }) : t('search.alerts.manage') }}
    </NuxtLink>
  </section>
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
  margin: 0 0.25rem 0 0;
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
  font-size: 0.75rem;
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
  font-size: 0.625rem;
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
  font-size: 0.75rem;
  color: rgb(var(--fg-muted) / 1);
  text-decoration: underline;
  text-underline-offset: 3px;
  text-decoration-color: rgb(var(--fg-faint) / 1);
}
.als-manage:hover {
  color: rgb(var(--fg-strong) / 1);
}
/* Dans le rail : une section comme les facettes, les pastilles en colonne. */
.als--rail {
  flex-direction: column;
  align-items: stretch;
  gap: 0.3rem;
  margin: 0;
}
.als--rail .als-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0 0 0.35rem;
}
.als--rail .als-eyebrow::after {
  content: '';
  flex: 1;
  height: 1px;
  background: rgb(var(--line-default) / 1);
}
.als--rail .al {
  justify-content: flex-start;
  border-radius: var(--radius-sm);
}
.als--rail .al-label {
  flex: 1;
}
.als--rail .als-manage {
  margin: 0.15rem 0 0 0.25rem;
  align-self: flex-start;
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
