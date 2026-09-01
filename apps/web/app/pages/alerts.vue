<template>
  <div class="alerts">
    <header class="al-head">
      <p class="al-eyebrow">{{ $t('alerts.eyebrow') }}</p>
      <h1 class="al-title">{{ $t('alerts.title') }}</h1>
      <p class="al-lede">{{ $t('alerts.lede') }}</p>
    </header>

    <p v-if="items.length" class="al-count">
      {{ $t('alerts.count', { used: items.length, max: data?.max ?? 0 }) }}
    </p>

    <div v-if="!items.length" class="al-empty">
      <Icon name="ph:bookmark-simple" class="al-empty-icon" />
      <h2>{{ $t('alerts.empty.title') }}</h2>
      <p>{{ $t('alerts.empty.body') }}</p>
      <NuxtLink to="/torrents" class="btn btn-secondary">
        <Icon name="ph:magnifying-glass" />
        {{ $t('alerts.empty.cta') }}
      </NuxtLink>
    </div>

    <ul v-else class="al-list">
      <li v-for="s in items" :key="s.id" class="al-item">
        <div class="al-item-main">
          <h2 class="al-item-label">{{ s.label }}</h2>
          <p class="al-criteria">
            <span v-if="s.query" class="al-chip al-chip--text">
              <Icon name="ph:text-aa" />{{ s.query }}
            </span>
            <span v-if="s.category" class="al-chip">
              <Icon name="ph:folder" />{{ s.category.name }}
            </span>
            <span v-for="tag in s.tags ?? []" :key="tag" class="al-chip">
              <Icon name="ph:tag" />{{ tag }}
            </span>
            <span v-if="s.imdbId" class="al-chip"><Icon name="ph:film-slate" />{{ s.imdbId }}</span>
            <span v-if="s.tmdbId" class="al-chip"><Icon name="ph:film-slate" />{{ s.tmdbId }}</span>
            <span v-if="s.tvdbId" class="al-chip"><Icon name="ph:television" />{{ s.tvdbId }}</span>
          </p>
          <p class="al-meta">
            <template v-if="s.matchCount > 0">
              {{ $t('alerts.matched', { count: s.matchCount }) }}
              <span v-if="s.lastMatchedAt">
                · {{ $t('alerts.lastMatch', { when: formatAge(s.lastMatchedAt) }) }}
              </span>
            </template>
            <template v-else>{{ $t('alerts.noMatchYet') }}</template>
          </p>
        </div>

        <div class="al-item-actions">
          <NuxtLink :to="searchLink(s)" class="tool-btn" :title="$t('alerts.run')">
            <Icon name="ph:magnifying-glass-bold" />
          </NuxtLink>
          <button
            type="button"
            class="tool-btn tool-btn--danger"
            :disabled="busy === s.id"
            :title="$t('alerts.delete')"
            @click="remove(s)"
          >
            <Icon
              :name="busy === s.id ? 'ph:circle-notch' : 'ph:trash-bold'"
              :class="{ 'animate-spin': busy === s.id }"
            />
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
/**
 * A member's saved searches — the filters that notify them when a matching
 * release is accepted.
 *
 * Read-and-delete only. Filters are created from the catalogue page, where the
 * member already has the criteria in front of them; an edit form here would be
 * a second way to express the same thing, and the two would drift on every new
 * filter parameter.
 */
definePageMeta({ title: 'Alerts' });

interface SavedSearch {
  id: string;
  label: string;
  query: string | null;
  categoryId: string | null;
  category: { id: string; name: string; slug: string } | null;
  tags: string[] | null;
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  notify: boolean;
  createdAt: string;
  lastMatchedAt: string | null;
  matchCount: number;
}

const { t } = useI18n();
const notifications = useNotificationStore();

const { data, refresh } = await useFetch<{ items: SavedSearch[]; max: number }>(
  '/api/me/saved-searches',
  { default: () => ({ items: [], max: 20 }) }
);
const items = computed(() => data.value?.items ?? []);
const busy = ref<string | null>(null);

/** Rebuild the catalogue URL this filter came from, so "run it" is one click. */
function searchLink(s: SavedSearch): string {
  const q = new URLSearchParams();
  if (s.query) q.set('search', s.query);
  if (s.categoryId) q.set('categoryId', s.categoryId);
  if (s.tags?.length) q.set('tag', s.tags.join(','));
  if (s.imdbId) q.set('imdbid', s.imdbId);
  if (s.tmdbId) q.set('tmdbid', s.tmdbId);
  if (s.tvdbId) q.set('tvdbid', s.tvdbId);
  const qs = q.toString();
  return qs ? `/torrents?${qs}` : '/torrents';
}

async function remove(s: SavedSearch) {
  busy.value = s.id;
  try {
    await $fetch<{ success: boolean }>(`/api/me/saved-searches/${s.id}` as string, {
      method: 'DELETE',
    });
    await refresh();
  } catch (err: unknown) {
    const e = err as { data?: { message?: string }; message?: string };
    notifications.error(e?.data?.message || e?.message || t('alerts.deleteFailed'));
  } finally {
    busy.value = null;
  }
}

useHead({ title: () => t('alerts.title') });
</script>

<style scoped>
/*
 * A list of standing instructions, not a dashboard. Each row states what it
 * watches for and whether it has ever fired; everything else is noise on a
 * page somebody visits twice a year.
 */
.alerts {
  max-width: 52rem;
  margin: 0 auto;
  padding: 3rem 1.25rem 5rem;
}

.al-eyebrow {
  margin: 0 0 0.25rem;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.al-title {
  margin: 0;
  font-size: 1.6rem;
}
.al-lede {
  margin: 0.5rem 0 0;
  max-width: 46rem;
  font-size: 0.875rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}
.al-count {
  margin: 1.5rem 0 0.75rem;
  font-size: 0.75rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}

.al-empty {
  margin-top: 3rem;
  padding: 3rem 1.5rem;
  text-align: center;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 0.6rem;
}
.al-empty-icon {
  width: 2.5rem;
  height: 2.5rem;
  color: rgb(var(--fg-subtle));
}
.al-empty h2 {
  margin: 0.75rem 0 0.35rem;
  font-size: 1rem;
}
.al-empty p {
  margin: 0 auto 1.25rem;
  max-width: 34rem;
  font-size: 0.85rem;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}

.al-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-top: 1px solid rgb(var(--line-default));
}
.al-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
}
.al-item-main {
  min-width: 0;
}
.al-item-label {
  margin: 0 0 0.4rem;
  font-size: 0.95rem;
}
.al-criteria {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  margin: 0 0 0.4rem;
}
.al-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.1rem 0.4rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.25rem;
  font-size: 0.72rem;
  color: rgb(var(--fg-muted));
}
.al-chip--text {
  border-color: rgb(var(--accent) / 0.4);
  color: rgb(var(--accent));
}
.al-meta {
  margin: 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
}
.al-item-actions {
  display: flex;
  gap: 0.4rem;
  flex-shrink: 0;
}

@media (max-width: 34rem) {
  .al-item {
    flex-direction: column;
  }
}
</style>
