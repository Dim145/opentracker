<template>
  <div class="stats">
    <header class="st-head">
      <p class="st-eyebrow">{{ $t('stats.eyebrow') }}</p>
      <h1 class="st-title">{{ $t('stats.title') }}</h1>
      <p class="st-lede">{{ $t('stats.lede') }}</p>
    </header>

    <!-- The lead figures. Five numbers, sized so the page has one obvious
         beginning, in tabular numerals so they do not shuffle on refresh. -->
    <section class="st-lead" aria-labelledby="st-now">
      <h2 id="st-now" class="st-sr">{{ $t('stats.now.title') }}</h2>
      <div class="st-figures">
        <div v-for="(fig, i) in figures" :key="fig.key" class="st-figure" :style="delay(i)">
          <span class="st-figure-value">{{ fig.value }}</span>
          <span class="st-figure-label">{{ fig.label }}</span>
          <span v-if="fig.note" class="st-figure-note">{{ fig.note }}</span>
        </div>
      </div>
    </section>

    <!-- History. The window is a choice because a 30-day view and a year
         answer different questions, and a chart with no scale control invites
         the reader to guess which one they are looking at. -->
    <section class="st-panel" aria-labelledby="st-growth">
      <div class="st-panel-head">
        <h2 id="st-growth">{{ $t('stats.growth.title') }}</h2>
        <p class="st-panel-note">{{ $t('stats.growth.note') }}</p>
        <div class="st-windows" role="group" :aria-label="$t('stats.growth.windowAria')">
          <button
            v-for="w in WINDOWS"
            :key="w"
            type="button"
            class="st-window"
            :class="{ 'st-window--on': windowDays === w }"
            :aria-pressed="windowDays === w"
            @click="windowDays = w"
          >
            {{ $t('stats.growth.window', { days: w }) }}
          </button>
        </div>
      </div>

      <p v-if="!data?.points?.length" class="st-empty">{{ $t('stats.growth.none') }}</p>
      <div v-else class="st-charts">
        <StatsStatSeries
          :label="$t('stats.growth.torrents')"
          :points="data.points.map((p) => p.torrents)"
          :labels="data.points.map((p) => p.day)"
          :unit="$t('stats.growth.torrentsUnit')"
        />
        <StatsStatSeries
          :label="$t('stats.growth.members')"
          :points="data.points.map((p) => p.users)"
          :labels="data.points.map((p) => p.day)"
          :unit="$t('stats.growth.membersUnit')"
        />
        <StatsStatSeries
          :label="$t('stats.growth.traffic')"
          :points="(data.deltas ?? []).map((d) => d.bytes)"
          :labels="(data.deltas ?? []).map((d) => d.day)"
          kind="bars"
          :format="bytes"
        />
      </div>
    </section>

    <!-- The catalogue, by category. Bars rather than a pie: there are more than
         five categories on any real instance, and a reader wants to compare two
         of them rather than see a whole. Labelled directly, so the eye does not
         travel to a legend. -->
    <section class="st-panel" aria-labelledby="st-cats">
      <div class="st-panel-head">
        <h2 id="st-cats">{{ $t('stats.categories.title') }}</h2>
        <p class="st-panel-note">{{ $t('stats.categories.note') }}</p>
      </div>
      <p v-if="!categories.length" class="st-empty">{{ $t('stats.categories.none') }}</p>
      <ul v-else class="st-bars">
        <li v-for="cat in categories" :key="cat.id" class="st-bar-row">
          <NuxtLink :to="`/torrents?category=${cat.slug}`" class="st-bar-name">
            {{ cat.name }}
          </NuxtLink>
          <div class="st-bar-track">
            <div class="st-bar-fill" :style="{ width: `${barWidth(cat.torrents)}%` }" />
          </div>
          <span class="st-bar-count">{{ cat.torrents.toLocaleString() }}</span>
          <span class="st-bar-bytes">{{ bytes(cat.bytes) }}</span>
        </li>
      </ul>
    </section>

    <div class="st-columns">
      <!-- Two rankings, side by side. Same shape, different question: what the
           site grabbed, and what the site is keeping alive. -->
      <section class="st-panel" aria-labelledby="st-snatched">
        <div class="st-panel-head">
          <h2 id="st-snatched">{{ $t('stats.top.snatched') }}</h2>
        </div>
        <ol v-if="data?.mostSnatched?.length" class="st-rank">
          <li v-for="(t, i) in data.mostSnatched" :key="t.infoHash" class="st-rank-row">
            <span class="st-rank-n">{{ i + 1 }}</span>
            <NuxtLink :to="`/torrents/${t.infoHash}`" class="st-rank-name" :title="t.name">
              {{ t.name }}
            </NuxtLink>
            <span class="st-rank-meta">{{ t.categoryName ?? $t('stats.uncategorised') }}</span>
            <span class="st-rank-value">{{ t.snatches.toLocaleString() }}</span>
          </li>
        </ol>
        <p v-else class="st-empty">{{ $t('stats.top.none') }}</p>
      </section>

      <section class="st-panel" aria-labelledby="st-swarms">
        <div class="st-panel-head">
          <h2 id="st-swarms">{{ $t('stats.top.swarms') }}</h2>
        </div>
        <ol v-if="data?.biggestSwarms?.length" class="st-rank">
          <li v-for="(t, i) in data.biggestSwarms" :key="t.infoHash" class="st-rank-row">
            <span class="st-rank-n">{{ i + 1 }}</span>
            <NuxtLink :to="`/torrents/${t.infoHash}`" class="st-rank-name" :title="t.name">
              {{ t.name }}
            </NuxtLink>
            <span class="st-rank-meta">{{ bytes(t.size) }}</span>
            <span class="st-rank-value st-rank-value--up">{{ t.seeders.toLocaleString() }}</span>
          </li>
        </ol>
        <p v-else class="st-empty">{{ $t('stats.top.none') }}</p>
      </section>
    </div>

    <!-- The uploader board, with the sentence that explains what it is not.
         A leaderboard on a tracker is normally ranked by volume; this one is
         not, and a reader deserves to know why rather than assume an omission. -->
    <section class="st-panel" aria-labelledby="st-uploaders">
      <div class="st-panel-head">
        <h2 id="st-uploaders">{{ $t('stats.uploaders.title') }}</h2>
        <p class="st-panel-note">{{ $t('stats.uploaders.note') }}</p>
      </div>
      <ol v-if="data?.topUploaders?.length" class="st-board">
        <li v-for="(u, i) in data.topUploaders" :key="u.username" class="st-board-row">
          <span class="st-rank-n">{{ i + 1 }}</span>
          <NuxtLink :to="`/users/${u.id}`" class="st-board-name">{{ u.username }}</NuxtLink>
          <span class="st-board-count">{{ $t('stats.uploaders.count', { n: u.uploads }) }}</span>
        </li>
      </ol>
      <p v-else class="st-empty">{{ $t('stats.uploaders.none') }}</p>
    </section>

    <!-- The year. A separate act on the page rather than a separate route: the
         numbers above are what the site is, these are what a year of it was. -->
    <section class="st-year" aria-labelledby="st-year-h">
      <div class="st-panel-head">
        <h2 id="st-year-h">{{ $t('stats.year.title', { year }) }}</h2>
        <div class="st-windows" role="group" :aria-label="$t('stats.year.pickAria')">
          <button
            v-for="y in years"
            :key="y"
            type="button"
            class="st-window"
            :class="{ 'st-window--on': year === y }"
            :aria-pressed="year === y"
            @click="year = y"
          >
            {{ y }}
          </button>
        </div>
      </div>

      <div v-if="yearData" class="st-year-body">
        <div class="st-figures st-figures--year">
          <div class="st-figure">
            <span class="st-figure-value">{{ yearData.torrentsAdded.toLocaleString() }}</span>
            <span class="st-figure-label">{{ $t('stats.year.added') }}</span>
            <span class="st-figure-note">{{ bytes(yearData.bytesAdded) }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ yearData.membersJoined.toLocaleString() }}</span>
            <span class="st-figure-label">{{ $t('stats.year.joined') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ yearData.snatches.toLocaleString() }}</span>
            <span class="st-figure-label">{{ $t('stats.year.snatches') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">
              {{ yearData.trafficBytes === null ? '—' : bytes(yearData.trafficBytes) }}
            </span>
            <span class="st-figure-label">{{ $t('stats.year.traffic') }}</span>
            <!-- Said on the page and not only in the guide: this figure is a
                 floor, because the counter behind it drops when an account is
                 erased or a cheater is reset. -->
            <span class="st-figure-note">{{ $t('stats.year.trafficNote') }}</span>
          </div>
        </div>

        <StatsStatSeries
          v-if="monthPoints.length"
          :label="$t('stats.year.byMonth')"
          :points="monthPoints"
          :labels="monthLabels"
          kind="bars"
        />

        <div class="st-year-lists">
          <div>
            <h3 class="st-sub">{{ $t('stats.year.topCategories') }}</h3>
            <ul class="st-mini">
              <li v-for="c in yearData.topCategories" :key="c.id">
                <span>{{ c.name }}</span>
                <span class="st-mini-value">{{ c.torrents.toLocaleString() }}</span>
              </li>
              <li v-if="!yearData.topCategories.length" class="st-mini-empty">
                {{ $t('stats.year.nothing') }}
              </li>
            </ul>
          </div>
          <div>
            <h3 class="st-sub">{{ $t('stats.year.topReleases') }}</h3>
            <ul class="st-mini">
              <li v-for="r in yearData.topReleases" :key="r.infoHash">
                <NuxtLink :to="`/torrents/${r.infoHash}`" class="st-mini-link" :title="r.name">
                  {{ r.name }}
                </NuxtLink>
                <span class="st-mini-value">{{ r.snatches.toLocaleString() }}</span>
              </li>
              <li v-if="!yearData.topReleases.length" class="st-mini-empty">
                {{ $t('stats.year.nothing') }}
              </li>
            </ul>
          </div>
        </div>

        <p v-if="yearData.busiestDay" class="st-busiest">
          {{ $t('stats.year.busiest', {
            day: yearData.busiestDay.day,
            bytes: bytes(yearData.busiestDay.bytes),
          }) }}
        </p>
      </div>
      <p v-else class="st-empty">{{ $t('stats.year.none') }}</p>

      <!-- And the member's own. Their data, so it is theirs alone — no id in
           the URL, no staff view of it. -->
      <div v-if="mine" class="st-mine">
        <h3 class="st-sub">{{ $t('stats.mine.title', { year }) }}</h3>
        <div class="st-mine-grid">
          <div><b>{{ mine.uploads.toLocaleString() }}</b><span>{{ $t('stats.mine.uploads') }}</span></div>
          <template v-if="!mine.downloadsHidden">
            <div><b>{{ mine.snatches.toLocaleString() }}</b><span>{{ $t('stats.mine.snatches') }}</span></div>
            <div><b>{{ bytes(mine.bytesUp) }}</b><span>{{ $t('stats.mine.up') }}</span></div>
            <div><b>{{ bytes(mine.bytesDown) }}</b><span>{{ $t('stats.mine.down') }}</span></div>
            <div><b>{{ hours(mine.seedTimeSeconds) }}</b><span>{{ $t('stats.mine.seedTime') }}</span></div>
          </template>
          <div><b>{{ Math.round(mine.bonusEarned).toLocaleString() }}</b><span>{{ $t('stats.mine.bonus') }}</span></div>
        </div>
        <!-- Said rather than silently omitted: four missing figures with no
             explanation read as a broken page. -->
        <p v-if="mine.downloadsHidden" class="st-mine-cat">{{ $t('stats.mine.hidden') }}</p>
        <p v-if="mine.bestRelease" class="st-mine-best">
          {{ $t('stats.mine.best') }}
          <NuxtLink :to="`/torrents/${mine.bestRelease.infoHash}`">{{ mine.bestRelease.name }}</NuxtLink>
          <span class="st-mine-best-n">{{
            $t('stats.mine.bestSnatches', { n: mine.bestRelease.snatches })
          }}</span>
        </p>
        <p v-if="mine.topCategory" class="st-mine-cat">
          {{ $t('stats.mine.favourite', {
            category: mine.topCategory.name,
            n: mine.topCategory.torrents,
          }) }}
        </p>
      </div>
    </section>

    <p class="st-foot">{{ $t('stats.foot') }}</p>
  </div>
</template>

<script setup lang="ts">
/**
 * The state of the site, for the members of it.
 *
 * ## Why this page exists on a tracker
 *
 * Everything here was already in the database and visible only to
 * administrators. A member could see the four counters on the homepage and
 * nothing else — not how the catalogue is shaped, not whether the site is
 * growing, not what everybody is grabbing. Trackers that publish this keep
 * people; the numbers are the community looking at itself.
 *
 * ## The shape of the page is an argument
 *
 * Five lead figures, then history, then the catalogue, then rankings, then the
 * year. It reads top to bottom as "what the site is now" → "how it got here" →
 * "what is in it" → "what a year of it was", and each section is one question.
 * The alternative — a dashboard of twelve equal tiles — makes every number as
 * important as every other, which is another way of making none of them
 * important.
 *
 * ## What is not on it
 *
 * No per-member volume, anywhere. No ratio board, no "top downloaders". The
 * endpoint refuses to compute them and the note under the uploader board says
 * why: there is no setting on this site by which a member could opt out of one,
 * so publishing it would publish a figure nobody agreed to publish.
 *
 * ## Charts
 *
 * Drawn in `StatSeries`, from tokens, with the numbers reachable under each
 * one. See that component for why there is no charting library.
 */
const { t, locale } = useI18n();

useHead({ title: () => t('stats.title') });

const WINDOWS = [30, 90, 365] as const;
const windowDays = ref<number>(90);

interface SitePoint {
  day: string;
  users: number;
  torrents: number;
  peers: number;
  seeders: number;
  uploaded: number;
}
interface SiteStats {
  now: {
    torrents: number;
    members: number;
    seeders: number;
    leechers: number;
    snatches: number;
    catalogued: number;
    trafficTotal: number;
  };
  days: number;
  points: SitePoint[];
  deltas: Array<{ day: string; bytes: number; torrents: number; users: number }>;
  categories: Array<{ id: string; name: string; slug: string; torrents: number; bytes: number }>;
  mostSnatched: Array<{
    infoHash: string;
    name: string;
    categoryName: string | null;
    size: number;
    seeders: number;
    snatches: number;
  }>;
  biggestSwarms: SiteStats['mostSnatched'];
  topUploaders: Array<{ id: string; username: string; uploads: number }>;
  years: number[];
}

const { data } = await useFetch<SiteStats>('/api/stats/site', {
  query: computed(() => ({ window: String(windowDays.value) })),
});

const years = computed(() => data.value?.years ?? [new Date().getUTCFullYear()]);
const year = ref<number>(new Date().getUTCFullYear());
watch(years, (list) => {
  // Never leave the selector on a year the instance cannot answer for — an
  // empty review reads as a broken page rather than an empty year.
  if (list.length && !list.includes(year.value)) year.value = list[0]!;
});

interface YearStats {
  year: number;
  trafficBytes: number | null;
  torrentsAdded: number;
  bytesAdded: number;
  membersJoined: number;
  uploadersActive: number;
  snatches: number;
  busiestDay: { day: string; bytes: number } | null;
  months: Array<{ month: number; torrents: number; bytes: number }>;
  topCategories: Array<{ id: string; name: string; slug: string; torrents: number; bytes: number }>;
  topReleases: Array<{ infoHash: string; name: string; snatches: number }>;
}

const { data: yearData } = await useFetch<YearStats>('/api/stats/year', {
  query: computed(() => ({ year: String(year.value) })),
});

interface MineStats {
  /** True when the member has turned their download history off. */
  downloadsHidden?: boolean;
  uploads: number;
  snatches: number;
  seedTimeSeconds: number;
  bytesUp: number;
  bytesDown: number;
  bonusEarned: number;
  invitesUsed: number;
  topCategory: { name: string; torrents: number } | null;
  bestRelease: { infoHash: string; name: string; snatches: number } | null;
}

const { data: mine } = await useFetch<MineStats>('/api/me/year', {
  query: computed(() => ({ year: String(year.value) })),
});

/** Binary units, the ones a torrent client shows. */
function bytes(value: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let v = Math.max(0, value);
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${u === 0 ? Math.round(v) : v.toFixed(v < 10 ? 2 : 1)} ${units[u]}`;
}

function hours(seconds: number): string {
  const h = Math.round(seconds / 3600);
  return h >= 24
    ? t('stats.mine.days', { n: Math.round(h / 24) })
    : t('stats.mine.hours', { n: h });
}

const figures = computed(() => {
  const now = data.value?.now;
  return [
    {
      key: 'torrents',
      value: (now?.torrents ?? 0).toLocaleString(),
      label: t('stats.now.torrents'),
      note: bytes(now?.catalogued ?? 0),
    },
    {
      key: 'members',
      value: (now?.members ?? 0).toLocaleString(),
      label: t('stats.now.members'),
      note: '',
    },
    {
      key: 'seeders',
      value: (now?.seeders ?? 0).toLocaleString(),
      label: t('stats.now.seeders'),
      note: t('stats.now.leechers', { n: (now?.leechers ?? 0).toLocaleString() }),
    },
    {
      key: 'snatches',
      value: (now?.snatches ?? 0).toLocaleString(),
      label: t('stats.now.snatches'),
      note: '',
    },
    {
      key: 'traffic',
      value: bytes(now?.trafficTotal ?? 0),
      label: t('stats.now.traffic'),
      note: '',
    },
  ];
});

const categories = computed(() => (data.value?.categories ?? []).slice(0, 12));
const biggestCategory = computed(() =>
  Math.max(1, ...categories.value.map((c) => c.torrents))
);
function barWidth(count: number): number {
  // Relative to the largest, floored so a category with one torrent is still
  // visible rather than a line of zero width.
  return Math.max(1.5, (count / biggestCategory.value) * 100);
}

const MONTHS = computed(() =>
  Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(2000, i, 1)).toLocaleDateString(locale.value, {
      month: 'short',
      timeZone: 'UTC',
    })
  )
);
const monthPoints = computed(() => {
  const rows = yearData.value?.months ?? [];
  if (!rows.length) return [];
  // Zero-filled to twelve on purpose, unlike the daily series: a month with no
  // upload is a fact about the year, and the axis is the calendar rather than
  // however long the collector has been running.
  const byMonth = new Map(rows.map((r) => [r.month, r.torrents]));
  return MONTHS.value.map((_, i) => byMonth.get(i + 1) ?? 0);
});
const monthLabels = computed(() => MONTHS.value);

/** A staggered reveal, once, on the figures that lead the page. */
function delay(index: number) {
  return { animationDelay: `${index * 45}ms` };
}
</script>

<style scoped>
.stats {
  max-width: 74rem;
  margin: 0 auto;
  padding: 1.5rem 1rem 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

.st-sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}

/* ── head ─────────────────────────────────────────────────────────────── */
.st-head { display: flex; flex-direction: column; gap: 0.35rem; }
.st-eyebrow {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.18em * var(--tracking-scale));
  color: rgb(var(--accent-warm));
}
.st-title {
  font-family: var(--font-display);
  font-size: clamp(1.75rem, 4vw, 2.5rem);
  font-weight: 700;
  line-height: 1.1;
  color: rgb(var(--fg-strong));
}
.st-lede {
  font-size: 0.875rem;
  color: rgb(var(--fg-muted));
  max-width: 46ch;
}

/* ── lead figures ─────────────────────────────────────────────────────── */
.st-figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8.5rem, 1fr));
  gap: 1px;
  background: rgb(var(--line-default));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.st-figure {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.9rem 1rem;
  background: rgb(var(--bg-surface));
  animation: st-rise 260ms ease-out both;
}
.st-figure-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: clamp(1.25rem, 2.4vw, 1.625rem);
  font-weight: 700;
  color: rgb(var(--fg-strong));
  line-height: 1.1;
}
.st-figure-label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.12em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
}
.st-figure-note {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
}

@keyframes st-rise {
  from { opacity: 0; transform: translateY(0.35rem); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .st-figure { animation: none; }
}

/* ── panels ───────────────────────────────────────────────────────────── */
.st-panel {
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  background: rgb(var(--bg-surface));
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
  min-width: 0;
}
.st-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.st-panel-head h2 {
  font-size: 0.9375rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.st-panel-note {
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  max-width: 44ch;
}
.st-empty {
  padding: 1.25rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--fg-subtle));
}
.st-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(20rem, 1fr));
  gap: 1.75rem;
}

/* ── window switcher ──────────────────────────────────────────────────── */
.st-windows { display: flex; align-items: center; gap: 0.25rem; flex-wrap: wrap; }
.st-window {
  padding: 0.4rem 0.7rem;
  /* 36px reads right beside a 12px label with a mouse; a finger needs 44. The
     media query is on the INPUT rather than the width, because a small window
     on a desktop is still a mouse. */
  min-height: 2.25rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 150ms ease-out, border-color 150ms ease-out, background 150ms ease-out;
}
.st-window:hover { color: rgb(var(--fg-default)); border-color: rgb(var(--line-strong)); }
.st-window--on {
  background: rgb(var(--accent-warm) / 0.14);
  border-color: rgb(var(--accent-warm));
  color: rgb(var(--fg-strong));
}
@media (pointer: coarse) {
  .st-window { min-height: 2.75rem; padding-inline: 0.9rem; }
}

.st-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem 1.5rem;
}

/* ── category bars ────────────────────────────────────────────────────── */
.st-bars { display: flex; flex-direction: column; gap: 0.4rem; }
.st-bar-row {
  display: grid;
  grid-template-columns: minmax(6rem, 10rem) minmax(0, 1fr) 4rem 5rem;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.75rem;
}
.st-bar-name {
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-bar-name:hover { color: rgb(var(--accent-warm)); }
.st-bar-track {
  height: 0.5rem;
  border-radius: 999px;
  background: rgb(var(--bg-inset));
  overflow: hidden;
}
.st-bar-fill {
  height: 100%;
  border-radius: 999px;
  background: rgb(var(--chart-1));
}
.st-bar-count,
.st-bar-bytes {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: rgb(var(--fg-muted));
}
.st-bar-bytes { color: rgb(var(--fg-faint)); }
@media (max-width: 640px) {
  .st-bar-row { grid-template-columns: minmax(0, 1fr) 3.5rem; grid-template-areas: 'name count' 'track track'; }
  .st-bar-name { grid-area: name; }
  .st-bar-count { grid-area: count; }
  .st-bar-track { grid-area: track; }
  .st-bar-bytes { display: none; }
}

/* ── rankings ─────────────────────────────────────────────────────────── */
.st-rank, .st-board { display: flex; flex-direction: column; }
.st-rank-row, .st-board-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
  font-size: 0.8125rem;
}
.st-rank-row:last-child, .st-board-row:last-child { border-bottom: 0; }
.st-rank-n {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-faint));
  text-align: right;
}
.st-rank-name, .st-board-name {
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-rank-name:hover, .st-board-name:hover { color: rgb(var(--accent-warm)); }
.st-rank-meta {
  font-size: 0.6875rem;
  color: rgb(var(--fg-faint));
  white-space: nowrap;
}
.st-rank-value, .st-board-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted));
  white-space: nowrap;
}
.st-rank-value--up { color: rgb(var(--online)); }
.st-board-row { grid-template-columns: 1.5rem minmax(0, 1fr) auto; }
@media (max-width: 520px) {
  .st-rank-row { grid-template-columns: 1.5rem minmax(0, 1fr) auto; }
  .st-rank-meta { display: none; }
}

/* ── the year ─────────────────────────────────────────────────────────── */
.st-year {
  border: 1px solid rgb(var(--line-strong));
  border-radius: var(--radius-md);
  background:
    radial-gradient(120% 80% at 100% 0%, rgb(var(--accent-warm) / 0.07), transparent 60%),
    rgb(var(--bg-surface));
  padding: 1.1rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.st-year-body { display: flex; flex-direction: column; gap: 1.1rem; }
.st-figures--year { border-color: rgb(var(--line-default)); }
.st-year-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem;
}
.st-sub {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
  margin-bottom: 0.4rem;
}
.st-mini { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.8125rem; }
.st-mini li {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.2rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
}
.st-mini li:last-child { border-bottom: 0; }
.st-mini-link {
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-mini-link:hover { color: rgb(var(--accent-warm)); }
.st-mini-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted));
  flex: none;
}
.st-mini-empty { color: rgb(var(--fg-subtle)); font-size: 0.75rem; }
.st-busiest { font-size: 0.8125rem; color: rgb(var(--fg-muted)); }

/* ── the member's own year ────────────────────────────────────────────── */
.st-mine {
  border-top: 1px solid rgb(var(--line-default));
  padding-top: 0.9rem;
}
.st-mine-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
  gap: 0.75rem;
}
.st-mine-grid div { display: flex; flex-direction: column; }
.st-mine-grid b {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 1.0625rem;
  color: rgb(var(--fg-strong));
}
.st-mine-grid span {
  font-size: 0.625rem;
  text-transform: uppercase;
  letter-spacing: calc(0.1em * var(--tracking-scale));
  color: rgb(var(--fg-subtle));
}
.st-mine-best, .st-mine-cat {
  margin-top: 0.7rem;
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}
.st-mine-best a { color: rgb(var(--fg-default)); }
.st-mine-best a:hover { color: rgb(var(--accent-warm)); }
.st-mine-best-n {
  font-family: var(--font-mono);
  color: rgb(var(--fg-faint));
  margin-left: 0.4rem;
}

.st-foot {
  font-size: 0.6875rem;
  color: rgb(var(--fg-faint));
  text-align: center;
}
</style>
