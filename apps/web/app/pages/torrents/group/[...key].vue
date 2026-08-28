<template>
  <div class="group-page">
    <NuxtLink to="/torrents" class="group-back">
      <Icon name="ph:arrow-left-bold" /> {{ $t('search.group.back') }}
    </NuxtLink>

    <!--
      The header is the work; everything below is inventory. The poster is
      allowed to be large because it is the only non-technical thing on the
      page — the rest is monospace, counts and sizes, and a single image is
      what stops that reading as a log file.
    -->
    <header
      class="group-head"
      :class="{ 'group-head--bare': !poster?.posterUrl && !posterLoading }"
    >
      <figure v-if="poster?.posterUrl || posterLoading" class="group-poster">
        <img
          v-if="poster?.posterUrl"
          :src="poster.posterUrl"
          :alt="title"
          decoding="async"
        />
        <span v-else class="group-poster-skeleton" />
      </figure>

      <div class="group-head-body">
        <p class="group-eyebrow">
          <span class="group-src" :class="`group-src--${group?.source}`">
            <Icon :name="sourceIcon" />
            {{ sourceLabel }}
          </span>
        </p>

        <!-- Until the metadata lookup resolves, the heading is the largest
             release's filename. Setting a filename in a 2rem proportional
             face reads as a broken title, so the fallback is typeset as what
             it is: monospace, smaller, at ease with its own dots. -->
        <h1 class="group-title" :class="{ 'group-title--mono': !poster?.title }">
          {{ title }}
          <span v-if="poster?.year" class="group-year">{{ poster.year }}</span>
        </h1>

        <div class="group-metrics">
          <span class="metric">
            <b>{{ group?.releaseCount ?? 0 }}</b>
            {{ $t('search.group.releases', group?.releaseCount ?? 0) }}
          </span>
          <span class="metric-sep" />
          <span class="metric mono">{{ sizeSpan }}</span>
        </div>

        <!--
          The same chips the listing row carries, doing the same job: they say
          how the work has been cut and switch between those cuts. A page
          reached from a bookmark therefore opens where the listing would have
          opened it.
        -->
        <div v-if="scopes.length > 1" class="group-scopes">
          <button
            v-for="s in scopes"
            :key="s.scope"
            type="button"
            class="group-scope"
            :class="{ 'group-scope--active': s.scope === scope }"
            @click="scope = s.scope"
          >
            {{ scopeLabel(s) }}
          </button>
        </div>
      </div>
    </header>

    <p v-if="pending && !data" class="group-empty">{{ $t('common.loading') }}</p>
    <TorrentGroupTree
      v-else-if="scope"
      class="group-tree"
      :group-key="key"
      :scope="scope"
    />
  </div>
</template>

<script setup lang="ts">
// Authentication is enforced by `middleware/auth.global.ts`, which runs on
// every route; there is no named `auth` middleware to opt into.
import type { GroupScope, ScopeSummary } from '~/utils/groupScopes';

const route = useRoute();
const { t } = useI18n();

/**
 * The key rides the path rather than a query string so the URL reads as a
 * place — `/torrents/group/tmdb:tv/1396`. It contains a slash, so the
 * catch-all segment arrives split and is rejoined here.
 */
const key = computed(() => {
  const raw = route.params.key;
  return Array.isArray(raw) ? raw.join('/') : String(raw ?? '');
});

/**
 * One probe request, for the header. The tree below fetches its own scope —
 * including this one again, which the browser cache does not spare us. It
 * buys the page a header that renders before any scope is chosen, and the
 * chips that choose it; sharing state with the child instead would couple two
 * components that otherwise know nothing about each other.
 */
const { data, pending } = await useFetch<{
  group: {
    key: string;
    source: 'tmdb' | 'igdb' | 'openlibrary' | 'solo';
    externalId: string;
    releaseCount: number;
    /** How the work's releases split between the two catalogues; they overlap. */
    localCount?: number;
    partnerCount?: number;
    minSize: number;
    maxSize: number;
    leadName: string;
    categoryIds: string[];
    scopes: ScopeSummary[];
    defaultScope: GroupScope;
  };
}>('/api/torrents/group', { query: { key } });

const group = computed(() => data.value?.group);
const scopes = computed(() => group.value?.scopes ?? []);

const scope = ref<GroupScope | null>(null);
watch(
  group,
  (g) => {
    if (g && !scope.value) scope.value = g.defaultScope;
  },
  { immediate: true },
);

function scopeLabel(s: ScopeSummary): string {
  return s.scope === 'all'
    ? t('search.group.scope.all', s.units)
    : t(scopeLabelKey(s.scope), { n: s.units });
}

const hint = computed<'movie' | 'tv' | 'game' | 'book' | null>(() => {
  const g = group.value;
  if (!g) return null;
  if (g.source === 'igdb') return 'game';
  if (g.source === 'openlibrary') return 'book';
  if (g.externalId.startsWith('tv/')) return 'tv';
  if (g.externalId.startsWith('movie/')) return 'movie';
  return null;
});

const lookupId = computed(() => {
  const g = group.value;
  if (!g || g.source === 'solo') return null;
  return g.source === 'tmdb'
    ? g.externalId.replace(/^(movie|tv)\//, '')
    : g.externalId;
});

const posters = useMediaPosters();
watchEffect(() => {
  if (lookupId.value) posters.register(lookupId.value, hint.value);
});
const poster = computed(() => posters.posterFor(lookupId.value, hint.value));
const posterLoading = computed(() =>
  posters.isPosterLoading(lookupId.value, hint.value),
);

/** Falls back to the largest release's filename until metadata resolves. */
const title = computed(
  () => poster.value?.title || group.value?.leadName || key.value,
);

const sizeSpan = computed(() => {
  const g = group.value;
  if (!g || !g.releaseCount) return '—';
  return g.minSize === g.maxSize
    ? formatSize(g.maxSize)
    : `${formatSize(g.minSize)} – ${formatSize(g.maxSize)}`;
});

const sourceIcon = computed(() => {
  switch (group.value?.source) {
    case 'igdb':
      return 'ph:game-controller-fill';
    case 'openlibrary':
      return 'ph:book-open-fill';
    case 'tmdb':
      return 'ph:popcorn-fill';
    default:
      return 'ph:package-fill';
  }
});

const sourceLabel = computed(() => {
  switch (group.value?.source) {
    case 'igdb':
      return 'IGDB';
    case 'openlibrary':
      return 'OPEN LIBRARY';
    case 'tmdb':
      return 'TMDB';
    default:
      return t('search.uncategorised');
  }
});

useHead(() => ({ title: title.value }));
</script>

<style scoped>
.group-page {
  max-width: var(--container-max, 1200px);
  margin: 0 auto;
  padding: 1.5rem var(--container-pad, 1rem) 4rem;
}

.group-back {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.6875rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 1.5rem;
}
.group-back:hover {
  color: rgb(var(--fg-default));
}

/* ── Header ───────────────────────────────────────────────────────────── */
.group-head {
  display: grid;
  grid-template-columns: 132px 1fr;
  gap: 1.5rem;
  padding-bottom: 1.5rem;
  border-bottom: 1px solid rgb(var(--line-default));
  margin-bottom: 1.5rem;
}
/* No poster, no poster column — otherwise the body lands in the 132px slot
   and the metrics stack into a narrow ribbon. */
.group-head--bare {
  grid-template-columns: 1fr;
}
@media (max-width: 640px) {
  .group-head {
    grid-template-columns: 88px 1fr;
    gap: 1rem;
  }
}

.group-poster {
  margin: 0;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius-sm, 4px);
  overflow: hidden;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
}
.group-poster img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.group-poster-skeleton {
  display: block;
  width: 100%;
  height: 100%;
  background: linear-gradient(
    100deg,
    rgb(var(--bg-elevated)) 30%,
    rgb(var(--bg-hover)) 50%,
    rgb(var(--bg-elevated)) 70%
  );
  background-size: 300% 100%;
  animation: shimmer 1.4s ease-in-out infinite;
}
@keyframes shimmer {
  to {
    background-position: -150% 0;
  }
}

.group-head-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.group-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
}

.group-src {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.5625rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.group-src--tmdb {
  color: rgb(var(--accent-warm));
}

.group-title {
  margin: 0;
  font-size: clamp(1.4rem, 3vw, 2rem);
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: rgb(var(--fg-strong));
}
.group-title--mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: clamp(0.8rem, 1.6vw, 1.1rem);
  line-height: 1.5;
  letter-spacing: 0;
  color: rgb(var(--fg-default));
  overflow-wrap: anywhere;
}

.group-year {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.875rem;
  font-weight: 400;
  color: rgb(var(--fg-faint));
  margin-left: 0.5rem;
}

.group-metrics {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.6rem;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}
/* Each figure wraps as a unit or not at all — a size span broken across four
   lines stops being a span. */
.metric {
  white-space: nowrap;
}
.metric b {
  color: rgb(var(--fg-default));
  font-weight: 600;
}
.metric.mono {
  font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.6875rem;
}
.metric-sep {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
  opacity: 0.5;
}
/* Once the row wraps, the separators are hanging punctuation at the end of
   each line. The gap alone reads better. */
@media (max-width: 640px) {
  .group-metrics {
    gap: 0.2rem 1rem;
  }
  .metric-sep {
    display: none;
  }
}

/* ── Scope chips ──────────────────────────────────────────────────────── */
.group-scopes {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.2rem;
}
.group-scope {
  font-size: 0.6875rem;
  font-weight: 500;
  padding: 3px 9px;
  border-radius: 3px;
  border: 1px solid rgb(var(--line-strong));
  background: transparent;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: border-color 120ms ease, color 120ms ease, background-color 120ms ease;
}
.group-scope:hover {
  color: rgb(var(--fg-default));
  border-color: rgb(var(--fg-faint));
}
.group-scope--active {
  background: rgb(167 139 250 / 0.18);
  border-color: rgb(167 139 250 / 0.5);
  color: rgb(196 181 253);
}

.group-tree {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md, 8px);
  overflow: hidden;
}

.group-empty {
  padding: 2rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--fg-faint));
}
</style>
