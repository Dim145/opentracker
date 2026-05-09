<template>
  <div class="dl-shell">
    <header class="dl-head">
      <div>
        <p class="dl-eyebrow">Personal · Activity</p>
        <h1 class="dl-title">Downloads</h1>
        <p class="dl-blurb">
          Every torrent you've started leeching, sorted by date.
          When the tracker has captured your share for a release the
          per-torrent uploaded / downloaded totals show up next to it.
        </p>
      </div>
      <div v-if="data" class="dl-stats">
        <span class="dl-stat">
          <strong>{{ data.total }}</strong>
          {{ data.total === 1 ? 'entry' : 'entries' }}
        </span>
        <span v-if="aggregate.up > 0 || aggregate.down > 0" class="dl-stat-sep" />
        <span v-if="aggregate.up > 0 || aggregate.down > 0" class="dl-stat">
          <Icon name="ph:arrow-up-bold" class="text-success" />
          <strong>{{ formatSize(aggregate.up) }}</strong>
        </span>
        <span v-if="aggregate.up > 0 || aggregate.down > 0" class="dl-stat">
          <Icon name="ph:arrow-down-bold" class="text-warning" />
          <strong>{{ formatSize(aggregate.down) }}</strong>
        </span>
      </div>
    </header>

    <!-- Loading skeleton: a few placeholder rows so the page doesn't
         flash blank while we wait for the first /api/me/downloads
         payload to arrive. -->
    <div v-if="pending && !data" class="dl-skeleton">
      <div v-for="i in 5" :key="`sk-${i}`" class="dl-row dl-row--skeleton" />
    </div>

    <div
      v-else-if="!data || data.items.length === 0"
      class="dl-empty"
    >
      <Icon name="ph:tray" class="dl-empty-icon" />
      <h3>No downloads yet</h3>
      <p>
        Once you start a download, the tracker stamps an entry here. Come
        back after grabbing your first torrent — it'll show up at the
        top of the list, freshest first.
      </p>
      <NuxtLink to="/torrents" class="dl-btn">
        <Icon name="ph:files" />
        Browse the catalogue
      </NuxtLink>
    </div>

    <ol v-else class="dl-list">
      <li v-for="item in data.items" :key="item.id" class="dl-row">
        <NuxtLink :to="`/torrents/${item.infoHash}`" class="dl-row-link">
          <!-- Poster slot — TMDb cover when we've got a hit, falls back to
               a status icon (download / completed / hnr) so the layout
               never collapses while the lookup is in flight. -->
          <figure
            v-if="posterBareFor(item) && (posters.isPosterLoading(posterBareFor(item)!, posterTypeFor(item)) || posters.posterFor(posterBareFor(item)!, posterTypeFor(item)))"
            class="dl-row-poster"
          >
            <img
              v-if="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.posterUrl"
              :src="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))!.posterUrl!"
              :alt="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.title || item.name"
              loading="lazy"
              decoding="async"
            />
            <Icon
              v-else-if="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))"
              name="ph:image-broken-bold"
              class="dl-row-poster-placeholder"
            />
            <span v-else class="dl-row-poster-skeleton" />
          </figure>
          <div v-else class="dl-row-icon">
            <Icon
              :name="
                item.isHnr
                  ? 'ph:warning-bold'
                  : item.completedAt
                    ? 'ph:check-circle-fill'
                    : 'ph:download-simple-bold'
              "
              :class="
                item.isHnr
                  ? 'text-error'
                  : item.completedAt
                    ? 'text-success'
                    : 'text-text-muted'
              "
            />
          </div>

          <div class="dl-row-body">
            <p
              v-if="item.category"
              class="dl-row-cat"
            >
              <Icon
                :name="categoryIcon(item.category.slug)"
                class="dl-row-cat-icon"
              />
              {{ item.category.name }}
              <template
                v-if="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.year"
              >
                <span class="dl-row-cat-sep">·</span>
                <span class="dl-row-year">
                  {{ posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.year }}
                </span>
              </template>
            </p>
            <!-- TMDb-resolved title floats up when we have a hit. The
                 raw filename moves underneath as a mono caption so power
                 users can still copy the exact release name. -->
            <p
              v-if="posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.title"
              class="dl-row-title"
            >
              {{ posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.title }}
            </p>
            <p
              class="dl-row-name"
              :class="{ 'dl-row-name--secondary': posters.posterFor(posterBareFor(item)!, posterTypeFor(item))?.title }"
            >
              {{ item.name }}
            </p>
            <p class="dl-row-meta">
              <time :title="absoluteDate(item.downloadedAt)">
                {{ formatAge(item.downloadedAt) }}
              </time>
              <span class="dl-row-meta-sep" />
              <span>{{ formatSize(item.size) }}</span>
              <template v-if="item.completedAt">
                <span class="dl-row-meta-sep" />
                <span class="dl-row-meta-completed">
                  <Icon name="ph:check-bold" />
                  Completed {{ formatAge(item.completedAt) }}
                </span>
              </template>
              <template v-else-if="item.isHnr">
                <span class="dl-row-meta-sep" />
                <span class="dl-row-meta-hnr">
                  <Icon name="ph:warning-bold" />
                  Hit & Run
                </span>
              </template>
            </p>
          </div>

          <div class="dl-row-bytes">
            <div class="dl-byte-cell">
              <span class="dl-byte-key">
                <Icon name="ph:arrow-up-bold" class="text-success" />
                Up
              </span>
              <span
                class="dl-byte-val"
                :class="{ 'dl-byte-val--empty': item.uploaded === 0 }"
              >
                {{ item.uploaded > 0 ? formatSize(item.uploaded) : '—' }}
              </span>
            </div>
            <div class="dl-byte-cell">
              <span class="dl-byte-key">
                <Icon name="ph:arrow-down-bold" class="text-warning" />
                Down
              </span>
              <span
                class="dl-byte-val"
                :class="{ 'dl-byte-val--empty': item.downloaded === 0 }"
              >
                {{ item.downloaded > 0 ? formatSize(item.downloaded) : '—' }}
              </span>
            </div>
            <div
              v-if="item.uploaded > 0 && item.downloaded > 0"
              class="dl-byte-cell"
            >
              <span class="dl-byte-key">Ratio</span>
              <span
                class="dl-byte-val"
                :class="ratioClass(item.uploaded / item.downloaded)"
              >
                {{ (item.uploaded / item.downloaded).toFixed(2) }}
              </span>
            </div>
          </div>
        </NuxtLink>
      </li>
    </ol>

    <!-- Pagination — same compact pager used on /search. -->
    <div v-if="data && data.total > data.pageSize" class="dl-foot">
      <p class="dl-foot-summary">
        Page <strong>{{ data.page }}</strong> /
        <strong>{{ pageCount }}</strong>
        ·
        <strong>{{ data.total }}</strong> total
      </p>
      <Pager
        :page="data.page"
        :pages="pageCount"
        @go="goToPage"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatAge } from '~/utils/format';
import Pager from '~/components/search/Pager.vue';

interface DownloadItem {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  imdbId: string | null;
  tmdbId: string | null;
  tvdbId: string | null;
  category: {
    id: string;
    name: string;
    slug: string;
    type: 'movie' | 'tv' | null;
  } | null;
  downloadedAt: string;
  completedAt: string | null;
  isHnr: boolean;
  isExempt: boolean;
  uploaded: number;
  downloaded: number;
}

interface DownloadsPayload {
  items: DownloadItem[];
  total: number;
  page: number;
  pageSize: number;
}

// `auth.global.ts` already gates every non-public route, so we don't
// need a per-page middleware here. Naming a non-existent local one
// (e.g. `'auth'`) blows up at boot with "Unknown route middleware".
useHead({ title: 'Downloads' });

const route = useRoute();
const router = useRouter();
const page = ref(parseInt((route.query.p as string) || '1', 10));
const pageSize = 25;

const { data, pending } = await useFetch<DownloadsPayload>(
  '/api/me/downloads',
  {
    query: computed(() => ({ page: page.value, pageSize })),
    watch: [page],
  }
);

// TMDb posters — shared composable, batches /api/metadata/lookup with
// a 3-state machine (loading / hit / missing). The Redis cache on the
// server keeps the upstream load tiny even for big pages.
const posters = useTmdbPosters();

function posterBareFor(item: DownloadItem): string | null {
  return posters.tmdbBare(item.tmdbId);
}
function posterTypeFor(item: DownloadItem): 'movie' | 'tv' | null {
  return posters.typeFromTmdbId(item.tmdbId) ?? item.category?.type ?? null;
}

// Trigger a fetch for every TMDb-tagged item in the current page. The
// composable dedupes; switching pages just enqueues new ids.
watch(
  () => data.value?.items ?? [],
  (items) => {
    for (const it of items) {
      const bare = posterBareFor(it);
      if (bare) posters.register(bare, posterTypeFor(it));
    }
  },
  { immediate: true }
);

const pageCount = computed(() =>
  data.value ? Math.max(1, Math.ceil(data.value.total / data.value.pageSize)) : 1
);

// Aggregate up/down across the page so the header strip can
// summarise the user's contribution at a glance — handy for power
// users who download a lot.
const aggregate = computed(() => {
  const items = data.value?.items ?? [];
  return items.reduce(
    (acc, it) => {
      acc.up += it.uploaded;
      acc.down += it.downloaded;
      return acc;
    },
    { up: 0, down: 0 }
  );
});

function goToPage(p: number) {
  page.value = p;
  router.replace({ query: { ...route.query, p: p > 1 ? p : undefined } });
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function absoluteDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function categoryIcon(slug: string): string {
  const icons: Record<string, string> = {
    movies: 'ph:film-slate-bold',
    tv: 'ph:television-bold',
    music: 'ph:music-notes-bold',
    games: 'ph:game-controller-bold',
    software: 'ph:app-window-bold',
    ebooks: 'ph:book-open-bold',
    anime: 'ph:shooting-star-bold',
    xxx: 'ph:prohibit-bold',
    other: 'ph:package-bold',
  };
  return icons[slug] || 'ph:folder-bold';
}

function ratioClass(r: number): string {
  if (r >= 2) return 'text-success';
  if (r >= 1) return 'text-text-strong';
  if (r >= 0.5) return 'text-warning';
  return 'text-error';
}

watch(
  () => route.query.p,
  (next) => {
    page.value = parseInt((next as string) || '1', 10);
  }
);
</script>

<style scoped>
.dl-shell {
  max-width: 80rem;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding-bottom: 4rem;
}

/* ─── Header ────────────────────────────────────────────── */
.dl-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 1.5rem;
  flex-wrap: wrap;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.dl-eyebrow {
  margin: 0 0 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.dl-title {
  margin: 0;
  font-size: clamp(1.6rem, 3.5vw, 2.1rem);
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.025em;
  color: rgb(var(--fg-strong));
}
.dl-blurb {
  margin: 0.4rem 0 0;
  max-width: 56ch;
  font-size: 13px;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.dl-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.65rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  flex-wrap: wrap;
}
.dl-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}
.dl-stat strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.dl-stat-sep {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: rgb(var(--fg-faint));
}

/* ─── List ──────────────────────────────────────────────── */
.dl-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.dl-row {
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  transition: border-color 0.14s, transform 0.14s;
}
.dl-row:hover {
  border-color: rgb(var(--line-strong));
  transform: translateY(-1px);
}
.dl-row--skeleton {
  height: 5rem;
  background: linear-gradient(
    100deg,
    rgb(var(--bg-surface)) 30%,
    rgb(var(--bg-elevated)) 50%,
    rgb(var(--bg-surface)) 70%
  );
  background-size: 220% 100%;
  animation: dl-shimmer 1.4s ease-in-out infinite;
}
@keyframes dl-shimmer {
  0%   { background-position: 100% 0; }
  100% { background-position: -100% 0; }
}

.dl-row-link {
  display: grid;
  /* `auto` first column flexes between the icon (2.4 rem) and the
     poster (3 rem) so neither variant pushes the body sideways. */
  grid-template-columns: auto 1fr auto;
  gap: 1rem;
  align-items: center;
  padding: 0.85rem 1rem;
  text-decoration: none;
  color: inherit;
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

/* Poster slot — fixed-size thumbnail (3.5 / 5.25 rem) so layout
   stays stable while TMDb loads. The skeleton shimmers in place
   until the lookup resolves; on miss we render a broken-image
   icon so the user knows we tried. */
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

.dl-row-body {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.dl-row-cat {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  width: max-content;
}
.dl-row-cat-icon {
  font-size: 10.5px;
}
/* Resolved TMDb title — same look as the eyebrow row above with the
   category, but elevated to the row's primary text. The filename
   below shrinks to a mono caption when it lives next to a real title. */
.dl-row-title {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-row-cat-sep {
  color: rgb(var(--fg-faint));
}
.dl-row-year {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700;
  color: rgb(var(--fg-muted));
}
.dl-row-name {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  font-weight: 600;
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dl-row-name--secondary {
  font-size: 11px;
  font-weight: 500;
  color: rgb(var(--fg-muted));
}
.dl-row-meta {
  margin: 0;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
}
.dl-row-meta-sep {
  width: 3px;
  height: 3px;
  border-radius: 9999px;
  background: rgb(var(--fg-faint));
}
.dl-row-meta-completed {
  color: rgb(var(--online));
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.dl-row-meta-hnr {
  color: rgb(var(--danger));
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}

/* Right-rail byte cells. They're always present (Up / Down) so the
   layout stays stable; missing data shows as "—" in the value. */
.dl-row-bytes {
  display: inline-flex;
  align-items: stretch;
  gap: 0;
  border-left: 1px solid rgb(var(--line-default));
  padding-left: 1rem;
}
.dl-byte-cell {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 4.5rem;
  padding: 0 0.85rem;
  border-right: 1px dashed rgb(var(--line-default));
}
.dl-byte-cell:last-child {
  border-right: 0;
  padding-right: 0;
}
.dl-byte-cell:first-child {
  padding-left: 0;
}
.dl-byte-key {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
}
.dl-byte-val {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.dl-byte-val--empty {
  color: rgb(var(--fg-faint));
  font-weight: 500;
}

/* ─── Empty state ───────────────────────────────────────── */
.dl-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.85rem;
  padding: 4rem 1.5rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
}
.dl-empty-icon {
  font-size: 2.5rem;
  color: rgb(var(--fg-faint));
}
.dl-empty h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.dl-empty p {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--fg-muted));
  max-width: 44ch;
  line-height: 1.55;
}
.dl-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.5rem 0.9rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--accent-fg));
  background: rgb(var(--fg-strong));
  border: 1px solid rgb(var(--fg-strong));
  border-radius: 4px;
  text-decoration: none;
  transition: background 0.14s;
}
.dl-btn:hover {
  background: rgb(var(--fg-default));
}

/* ─── Footer / pager ────────────────────────────────────── */
.dl-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding-top: 0.85rem;
  border-top: 1px solid rgb(var(--line-default));
  flex-wrap: wrap;
}
.dl-foot-summary {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.dl-foot-summary strong {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}

/* ─── Mobile reflow ───────────────────────────────────────── */
@media (max-width: 720px) {
  .dl-row-link {
    grid-template-columns: auto 1fr;
    row-gap: 0.65rem;
  }
  .dl-row-icon {
    width: 2rem;
    height: 2rem;
    font-size: 0.95rem;
  }
  .dl-row-poster {
    width: 2.5rem;
    height: 3.75rem;
  }
  .dl-row-bytes {
    grid-column: 1 / -1;
    border-left: 0;
    padding-left: 0;
    padding-top: 0.65rem;
    border-top: 1px solid rgb(var(--line-default));
    justify-content: space-around;
    width: 100%;
  }
  .dl-byte-cell {
    padding: 0;
    border-right: 0;
  }
}
</style>
