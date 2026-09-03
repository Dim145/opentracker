<template>
  <div class="stats">
    <header class="st-head">
      <h1 class="st-title">{{ $t('stats.title') }}</h1>
      <p class="st-lede">{{ $t('stats.lede') }}</p>
    </header>

    <!-- The lead figures. Five numbers, sized so the page has one obvious
         beginning, in tabular numerals so they do not shuffle on refresh. -->
    <section class="st-lead" aria-labelledby="st-now">
      <!-- Visible, not screen-reader-only. This label is the only thing that
           says the five figures below are CURRENT while the charts under them
           are historical, and hiding it meant sighted readers were the ones who
           never got told. -->
      <h2 id="st-now" class="st-micro st-micro--accent">{{ $t('stats.now.title') }}</h2>
      <div class="st-figures">
        <div v-for="(fig, i) in figures" :key="fig.key" class="st-figure" :style="delay(i)">
          <span class="st-figure-value">{{ fig.value }}</span>
          <span class="st-figure-label st-micro">{{ fig.label }}</span>
          <span v-if="fig.note" class="st-figure-note">{{ fig.note }}</span>
        </div>
      </div>
    </section>

    <!-- History. The window is a choice because a 30-day view and a year
         answer different questions, and a chart with no scale control invites
         the reader to guess which one they are looking at. -->
    <section class="st-panel" aria-labelledby="st-growth">
      <div class="st-panel-head">
        <div class="st-panel-text">
          <h2 id="st-growth" class="st-panel-title">{{ $t('stats.growth.title') }}</h2>
          <p class="st-panel-note">{{ $t('stats.growth.note') }}</p>
        </div>
        <!-- A radiogroup, not a set of toggle buttons. `aria-pressed` on
             mutually exclusive options announces "30 days, not pressed" for
             every option the reader did not choose, implying each can be turned
             on independently. -->
        <div class="st-windows" role="radiogroup" :aria-label="$t('stats.growth.windowAria')">
          <button
            v-for="w in WINDOWS"
            :key="w"
            type="button"
            role="radio"
            class="st-window"
            :class="{ 'st-window--on': windowDays === w }"
            :aria-checked="windowDays === w"
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
          :labels="dayLabels(data.points.map((p) => p.day))"
          :unit="$t('stats.growth.torrentsUnit')"
        />
        <StatsStatSeries
          :label="$t('stats.growth.members')"
          :points="data.points.map((p) => p.users)"
          :labels="dayLabels(data.points.map((p) => p.day))"
          :unit="$t('stats.growth.membersUnit')"
        />
        <!-- Full width, and last. It is the only per-period series here — the
             two above are cumulative counters — so sitting as the third panel
             of a matched triptych made a different kind of measurement look
             like more of the same. Width is also what a bar chart wants. -->
        <div class="st-chart-wide">
          <StatsStatSeries
            :label="$t('stats.growth.traffic')"
            :points="(data.deltas ?? []).map((d) => d.bytes)"
            :labels="dayLabels((data.deltas ?? []).map((d) => d.day))"
            kind="bars"
            :format="bytes"
          />
        </div>
      </div>
    </section>

    <!-- The catalogue, by category. Bars rather than a pie: there are more than
         five categories on any real instance, and a reader wants to compare two
         of them rather than see a whole. Labelled directly, so the eye does not
         travel to a legend. -->
    <section class="st-panel" aria-labelledby="st-cats">
      <div class="st-panel-head">
        <div class="st-panel-text">
          <h2 id="st-cats" class="st-panel-title">{{ $t('stats.categories.title') }}</h2>
          <p class="st-panel-note">{{ $t('stats.categories.note') }}</p>
        </div>
      </div>
      <div v-if="!categories.length" class="st-blank">
        <Icon name="ph:folders" class="st-blank-icon" />
        <p>{{ $t('stats.categories.none') }}</p>
      </div>
      <ul v-else class="st-bars">
        <li v-for="cat in categories" :key="cat.id" class="st-bar-row">
          <NuxtLink :to="`/torrents?category=${cat.slug}`" class="st-bar-name">
            {{ cat.name }}
          </NuxtLink>
          <div class="st-bar-track">
            <div class="st-bar-fill" :style="{ width: `${barWidth(cat.torrents)}%` }" />
          </div>
          <span class="st-bar-count" :data-bytes="bytes(cat.bytes)">
            {{ cat.torrents.toLocaleString() }}
          </span>
          <span class="st-bar-bytes">{{ bytes(cat.bytes) }}</span>
        </li>
      </ul>
    </section>

    <div class="st-columns">
      <!-- Two rankings, side by side. Same shape, different question: what the
           site grabbed, and what the site is keeping alive. Both are all-time
           and both now say so — the window switcher above governs the history
           panel only, and a reader who picked "30 days" and watched these not
           move would otherwise conclude the page was stuck. -->
      <section class="st-panel" aria-labelledby="st-snatched">
        <div class="st-panel-head">
          <div class="st-panel-text">
            <h2 id="st-snatched" class="st-panel-title">{{ $t('stats.top.snatched') }}</h2>
          </div>
        </div>
        <template v-if="data?.mostSnatched?.length">
          <!-- A header row, because ten bare numbers in a column with no unit
               were attached to their meaning only by a panel title 200px
               above. Both boards now put the same measure in column three, so
               the eye can read down it. -->
          <div class="st-rank-head st-micro" aria-hidden="true">
            <span />
            <span>{{ $t('stats.rank.release') }}</span>
            <span class="st-rank-num">{{ $t('stats.rank.size') }}</span>
            <span class="st-rank-num">{{ $t('stats.rank.snatches') }}</span>
          </div>
          <ol class="st-rank">
            <li v-for="(t, i) in data.mostSnatched" :key="t.infoHash" class="st-rank-row">
              <span class="st-rank-n">{{ i + 1 }}</span>
              <NuxtLink :to="`/torrents/${t.infoHash}`" class="st-rank-name" :title="t.name">
                {{ t.name }}
              </NuxtLink>
              <span class="st-rank-meta">{{ bytes(t.size) }}</span>
              <span class="st-rank-value">{{ t.snatches.toLocaleString() }}</span>
            </li>
          </ol>
          <NuxtLink to="/torrents?s=completed&d=desc" class="st-more">
            {{ $t('stats.rank.more') }}
          </NuxtLink>
        </template>
        <div v-else class="st-blank">
          <Icon name="ph:download-simple" class="st-blank-icon" />
          <p>{{ $t('stats.top.none') }}</p>
        </div>
      </section>

      <section class="st-panel" aria-labelledby="st-swarms">
        <div class="st-panel-head">
          <div class="st-panel-text">
            <h2 id="st-swarms" class="st-panel-title">{{ $t('stats.top.swarms') }}</h2>
          </div>
        </div>
        <template v-if="data?.biggestSwarms?.length">
          <div class="st-rank-head st-micro" aria-hidden="true">
            <span />
            <span>{{ $t('stats.rank.release') }}</span>
            <span class="st-rank-num">{{ $t('stats.rank.size') }}</span>
            <span class="st-rank-num">{{ $t('stats.rank.seeders') }}</span>
          </div>
          <ol class="st-rank">
            <li v-for="(t, i) in data.biggestSwarms" :key="t.infoHash" class="st-rank-row">
              <span class="st-rank-n">{{ i + 1 }}</span>
              <NuxtLink :to="`/torrents/${t.infoHash}`" class="st-rank-name" :title="t.name">
                {{ t.name }}
              </NuxtLink>
              <span class="st-rank-meta">{{ bytes(t.size) }}</span>
              <span class="st-rank-value">{{ t.seeders.toLocaleString() }}</span>
            </li>
          </ol>
          <NuxtLink to="/torrents?s=seeders&d=desc" class="st-more">
            {{ $t('stats.rank.more') }}
          </NuxtLink>
        </template>
        <div v-else class="st-blank">
          <Icon name="ph:users-three" class="st-blank-icon" />
          <p>{{ $t('stats.top.none') }}</p>
        </div>
      </section>
    </div>

    <!-- The uploader board, with the sentence that explains what it is not.
         A leaderboard on a tracker is normally ranked by volume; this one is
         not, and a reader deserves to know why rather than assume an omission.
         The full argument lives in the guide — a panel header is not a
         paragraph. -->
    <section class="st-panel" aria-labelledby="st-uploaders">
      <div class="st-panel-head">
        <div class="st-panel-text">
          <h2 id="st-uploaders" class="st-panel-title">{{ $t('stats.uploaders.title') }}</h2>
          <p class="st-panel-note">{{ $t('stats.uploaders.note') }}</p>
        </div>
      </div>
      <ol v-if="data?.topUploaders?.length" class="st-board">
        <li v-for="(u, i) in data.topUploaders" :key="u.username" class="st-board-row">
          <span class="st-rank-n">{{ i + 1 }}</span>
          <NuxtLink :to="`/users/${u.id}`" class="st-board-name">{{ u.username }}</NuxtLink>
          <span class="st-board-count">{{ $t('stats.uploaders.count', u.uploads) }}</span>
        </li>
      </ol>
      <div v-else class="st-blank">
        <Icon name="ph:upload-simple" class="st-blank-icon" />
        <p>{{ $t('stats.uploaders.none') }}</p>
      </div>
    </section>

    <!-- The year. A separate act on the page rather than a separate route: the
         numbers above are what the site is, these are what a year of it was.
         A rule across the page and the display face are what make it an act —
         a 7 % tint and 0.1rem of extra padding were differences at the
         threshold of perception. -->
    <section class="st-year" aria-labelledby="st-year-h">
      <div class="st-panel-head">
        <div class="st-panel-text">
          <h2 id="st-year-h" class="st-year-title">{{ $t('stats.year.title', { year }) }}</h2>
        </div>
        <!-- Hidden when there is only one year to pick: a lone chip that looks
             like a control and switches to nothing reads as a broken one. -->
        <div
          v-if="years.length > 1"
          class="st-windows"
          role="radiogroup"
          :aria-label="$t('stats.year.pickAria')"
        >
          <button
            v-for="y in years"
            :key="y"
            type="button"
            role="radio"
            class="st-window"
            :class="{ 'st-window--on': year === y }"
            :aria-checked="year === y"
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
            <span class="st-figure-label st-micro">{{ $t('stats.year.added') }}</span>
            <span class="st-figure-note">{{ bytes(yearData.bytesAdded) }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ yearData.membersJoined.toLocaleString() }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.year.joined') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ yearData.snatches.toLocaleString() }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.year.snatches') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">
              {{ yearData.trafficBytes === null ? '—' : bytes(yearData.trafficBytes) }}
            </span>
            <span class="st-figure-label st-micro">{{ $t('stats.year.traffic') }}</span>
            <!-- Said on the page and not only in the guide: this figure is a
                 floor, because the counter behind it drops when an account is
                 erased or a cheater is reset. -->
            <span class="st-figure-note">{{ $t('stats.year.trafficNote') }}</span>
          </div>
        </div>

        <div class="st-year-chart">
          <StatsStatSeries
            v-if="monthPoints.length"
            :label="$t('stats.year.byMonth')"
            :points="monthPoints"
            :labels="monthLabels"
            kind="bars"
          />
        </div>

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
    </section>

    <!-- And the member's own — its own section, at the same weight as the rest
         of the page. It was a 1px rule inside the year panel under a heading
         smaller than the body text it introduced, which put the reader's own
         numbers at the quietest point of a page whose whole argument is that
         the numbers are the community looking at itself. Their data, so it is
         theirs alone: no id in the URL, no staff view of it. -->
    <section v-if="mine" class="st-panel" aria-labelledby="st-mine-h">
      <div class="st-panel-head">
        <div class="st-panel-text">
          <h2 id="st-mine-h" class="st-panel-title">{{ $t('stats.mine.title', { year }) }}</h2>
        </div>
      </div>
      <div class="st-figures st-figures--mine">
        <div class="st-figure">
          <span class="st-figure-value">{{ mine.uploads.toLocaleString() }}</span>
          <span class="st-figure-label st-micro">{{ $t('stats.mine.uploads') }}</span>
        </div>
        <template v-if="!mine.downloadsHidden">
          <div class="st-figure">
            <span class="st-figure-value">{{ mine.snatches.toLocaleString() }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.mine.snatches') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ bytes(mine.bytesUp) }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.mine.up') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ bytes(mine.bytesDown) }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.mine.down') }}</span>
          </div>
          <div class="st-figure">
            <span class="st-figure-value">{{ hours(mine.seedTimeSeconds) }}</span>
            <span class="st-figure-label st-micro">{{ $t('stats.mine.seedTime') }}</span>
          </div>
        </template>
        <div class="st-figure">
          <span class="st-figure-value">{{ Math.round(mine.bonusEarned).toLocaleString() }}</span>
          <span class="st-figure-label st-micro">{{ $t('stats.mine.bonus') }}</span>
        </div>
      </div>
      <!-- Said rather than silently omitted: four missing figures with no
           explanation read as a broken page. -->
      <p v-if="mine.downloadsHidden" class="st-mine-cat">{{ $t('stats.mine.hidden') }}</p>
      <p v-if="mine.bestRelease" class="st-mine-best">
        {{ $t('stats.mine.best') }}
        <NuxtLink :to="`/torrents/${mine.bestRelease.infoHash}`">
          {{ mine.bestRelease.name }}
        </NuxtLink>
        <span class="st-mine-best-n">
          {{ $t('stats.mine.bestSnatches', mine.bestRelease.snatches) }}
        </span>
      </p>
      <p v-if="mine.topCategory" class="st-mine-cat">
        {{ $t('stats.mine.favourite', {
          category: mine.topCategory.name,
          n: mine.topCategory.torrents,
        }) }}
      </p>
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
 * year, then the reader's own year. It reads top to bottom as "what the site is
 * now" → "how it got here" → "what is in it" → "what a year of it was" → "what
 * your year was", and each section is one question. The alternative — a
 * dashboard of twelve equal tiles — makes every number as important as every
 * other, which is another way of making none of them important.
 *
 * ## The numbers outweigh the title
 *
 * They did not at first: the `h1` was the largest object on the page at 40px
 * against 26px figures, so a reader arriving to ask "how is the site doing"
 * read a label before they read an answer. The title is now on the house scale
 * and the figures are the biggest thing on the page, which is the right way
 * round for an instrument.
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
 * one. See that component for why there is no charting library, and for why a
 * cumulative scale is anchored at its minimum — and labelled, so that choice is
 * honest rather than flattering.
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

/**
 * `2026-06-03` → `3 Jun` / `3 juin`.
 *
 * The month chart was already localised and the daily ones were not, so one
 * page showed `2026-06-03` on one axis and `juin` on another — and the ISO
 * string is also what the chart's `aria-label` reads aloud, one digit at a
 * time. Built from the parts rather than parsed, so a zone-less date is not
 * shifted a day by the reader's own timezone.
 */
function dayLabels(days: string[]): string[] {
  return days.map((d) => {
    const parts = d.split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return d;
    return new Date(Date.UTC(parts[0]!, parts[1]! - 1, parts[2]!)).toLocaleDateString(
      locale.value,
      { day: 'numeric', month: 'short', timeZone: 'UTC' }
    );
  });
}

/**
 * The change over the shown window, for the two figures that have one.
 *
 * The page's headline question is "is the site growing", and not one of the
 * five lead figures carried a delta — so a reader had to scroll to an unlabelled
 * slope to answer it, while the numbers were already on the wire in `deltas`.
 * Only the two counts get one: a delta on "seeders right now" is noise, and the
 * traffic figure carries a caveat instead.
 */
const growth = computed(() => {
  const rows = data.value?.deltas ?? [];
  const sum = (pick: (row: (typeof rows)[number]) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return { torrents: sum((r) => r.torrents), users: sum((r) => r.users), days: rows.length };
});

function deltaNote(n: number): string {
  if (n <= 0 || !growth.value.days) return '';
  return t('stats.delta', { n: n.toLocaleString(), days: growth.value.days });
}

const figures = computed(() => {
  const now = data.value?.now;
  return [
    {
      key: 'torrents',
      value: (now?.torrents ?? 0).toLocaleString(),
      label: t('stats.now.torrents'),
      note: deltaNote(growth.value.torrents),
    },
    {
      key: 'members',
      value: (now?.members ?? 0).toLocaleString(),
      label: t('stats.now.members'),
      note: deltaNote(growth.value.users),
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
      // The same caveat the year's traffic figure carries, and it applies here
      // with more force: an all-time counter has accumulated more erasures.
      note: t('stats.year.trafficNote'),
    },
  ];
});

const categories = computed(() => (data.value?.categories ?? []).slice(0, 12));

/**
 * Bars are each category's share of the catalogue, not its share of the
 * largest category.
 *
 * Normalising to the biggest category made the top one a full bar on every
 * instance, and a reader reads a bar as share-of-whole — the tell being that
 * the panel note had to teach them otherwise. A shared denominator also means
 * two categories can be compared by eye, which is the whole reason this is a
 * bar chart and not a list.
 */
const catalogueTotal = computed(() =>
  Math.max(
    1,
    categories.value.reduce((sum, c) => sum + c.torrents, 0)
  )
);
function barWidth(count: number): number {
  // A 0.5 % floor rather than 1.5 %: at 1.5 % of a 700px track with a pill
  // radius, a small category rendered as a 10px circle that read as a list
  // bullet rather than as a bar.
  return Math.max(0.5, (count / catalogueTotal.value) * 100);
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
  /* 1280px, matching `me.vue`. The page used to cap itself at 1184px inside a
     1400px shell and add its own gutter on top of the layout's, so the eyebrow
     sat 140px in from the brand and moving between pages stepped the content
     sideways. A narrow measure belongs on the lede, not on the whole page. */
  max-width: 80rem;
  margin: 0 auto;
  padding: 1.5rem 0 3rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* ── head ─────────────────────────────────────────────────────────────── */
.st-head { display: flex; flex-direction: column; gap: 0.35rem; }
.st-title {
  font-family: var(--font-display);
  /* On the house scale (`.h-page`, `.search-title`) rather than 1.5× above it.
     A title is a label; the figures under it are the answer. */
  font-size: clamp(1.5rem, 3vw, 1.875rem);
  font-weight: 700;
  line-height: 1.1;
  color: rgb(var(--fg-strong));
}
.st-lede {
  font-size: 0.875rem;
  color: rgb(var(--fg-muted));
  max-width: 60ch;
}

/* One micro-label rule for the page.
   There were five, differing only in tracking — 0.10em, 0.12em, 0.14em, 0.18em
   — which no reader can tell apart and which meant the shared `.eyebrow` was
   being rewritten five ways. Role is carried by colour, not by tracking. */
.st-micro {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
}
.st-micro--accent { color: rgb(var(--accent-warm)); }

/* ── lead figures ─────────────────────────────────────────────────────── */
.st-lead { display: flex; flex-direction: column; gap: 0.5rem; }
/*
 * Hairlines by per-cell border, not by a 1px gap over a coloured parent.
 *
 * The gap trick draws its lines by letting the parent's background show
 * through — which also shows through any cell the grid does not fill. With five
 * items and an `auto-fit` track count the row was only even at five columns
 * (748px of viewport); every width below that left a solid grey rectangle where
 * a figure should be, and on a phone it sat above the fold. Explicit tracks
 * plus `border-right`/`border-bottom` cannot produce one, whatever the count.
 */
.st-figures {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
  /* The surface belongs to the container, not the cells: an unfilled cell then
     shows the same colour as a filled one instead of a hole. */
  background: rgb(var(--bg-surface));
}
.st-figure {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.9rem 1rem;
  /* Separators as an OUTWARD shadow rather than a border, so the outer edge
     stays exactly 1px. A border on every cell adds its own pixel next to the
     container's, giving a 2px rule along the bottom and right; a shadow in the
     1px band outside the cell lands on the container's border there and is
     clipped by `overflow: hidden`, while an interior one paints onto the
     container's background with no sibling to cover it. Transparent cells are
     what make that work. */
  box-shadow:
    1px 0 0 rgb(var(--line-default)),
    0 1px 0 rgb(var(--line-default));
  animation: st-rise 260ms ease-out both;
  min-width: 0;
}
/* No vertical separator after the final cell: when the last row is short — five
   figures over two or three columns — that line divided the cell from empty
   space and read as a missing tile. The horizontal rule stays, because the
   container's own border completes the bottom edge across the gap. */
.st-figure:last-child {
  box-shadow: 0 1px 0 rgb(var(--line-default));
}
.st-figures--year { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.st-figures--mine { grid-template-columns: repeat(6, minmax(0, 1fr)); }
@media (max-width: 72rem) {
  .st-figures--mine { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 60rem) {
  .st-figures { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .st-figures--year { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 34rem) {
  .st-figures,
  .st-figures--mine { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
.st-figure-value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  /* Now the largest thing on the page. */
  font-size: clamp(1.5rem, 3vw, 2rem);
  font-weight: 700;
  color: rgb(var(--fg-strong));
  line-height: 1.1;
  overflow-wrap: anywhere;
}
.st-figure-note {
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-subtle));
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
/*
 * Two children, always: a text block and a controls block.
 *
 * With `space-between` and a bare title-plus-note, the note was flung to the
 * far right edge and rendered as a narrow column of text some 770px from the
 * heading it belonged to — so the copy explaining a chart read as unrelated
 * marginalia. Wrapping the title with its note fixes three of six panels at the
 * default desktop width.
 */
.st-panel-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 0.5rem 1rem;
}
.st-panel-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.st-panel-title {
  font-size: 1rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.st-panel-note {
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  max-width: 60ch;
}
.st-empty {
  padding: 1.25rem 0;
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--fg-subtle));
}
/* The house empty state — dashed box, icon, sentence — for the panel-level
   ones. On a fresh instance every panel on this page is empty at once, and five
   centred grey sentences read as a broken page rather than a new one. */
.st-blank {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 1.75rem 1rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  text-align: center;
  font-size: 0.8125rem;
  color: rgb(var(--fg-subtle));
}
.st-blank-icon { font-size: 1.5rem; color: rgb(var(--fg-subtle)); }
.st-columns {
  display: grid;
  /* One column until ~900px. `minmax(20rem, …)` went two-up at 696px, where
     each ranking panel is 354px wide and still renders its size column — which
     truncated release names at about 28 characters, and a scene name is
     unrecognisable at 28 characters. */
  grid-template-columns: repeat(auto-fit, minmax(26rem, 1fr));
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
  /* A pill, like every other segmented control in the house. */
  border-radius: var(--radius-pill);
  background: rgb(var(--bg-elevated));
  color: rgb(var(--fg-muted));
  font-size: 0.75rem;
  cursor: pointer;
  transition: color 150ms ease-out, border-color 150ms ease-out, background 150ms ease-out;
}
.st-window:hover { color: rgb(var(--fg-default)); border-color: rgb(var(--line-strong)); }
/* Inverted, like `.search-mode-btn--on` and `.cat-pill--on`. A 14 % tint plus a
   border colour was the weakest selected state in the app. */
.st-window--on {
  background: rgb(var(--fg-strong));
  border-color: rgb(var(--fg-strong));
  color: rgb(var(--bg-base));
}
@media (pointer: coarse) {
  .st-window { min-height: 2.75rem; padding-inline: 0.9rem; }
}

.st-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem 1.5rem;
}
.st-chart-wide { grid-column: 1 / -1; }

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
  border-radius: var(--radius-pill);
  /* Not `--bg-inset`: in the light theme that is 245 on a 255 panel, a 4 %
     step, so the reader saw a floating lozenge with no visible "out of" — a
     proportion with no denominator. A tint of the foreground works in both
     themes and survives an operator's palette. */
  background: rgb(var(--fg-default) / 0.07);
  overflow: hidden;
}
.st-bar-fill {
  height: 100%;
  /* Square-ish rather than a pill, so a small share still reads as a bar stub
     instead of a bullet. */
  border-radius: var(--radius-xs);
  background: rgb(var(--accent-warm));
}
.st-bar-count,
.st-bar-bytes {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
  color: rgb(var(--fg-muted));
}
.st-bar-bytes { color: rgb(var(--fg-subtle)); }
@media (max-width: 640px) {
  /* Row-internal gap tighter than the gap between rows. It was the other way
     round — 0.6rem inside a row against 0.4rem between them — so twelve
     categories read as twenty-four loosely related lines. */
  .st-bar-row {
    grid-template-columns: minmax(0, 1fr) auto;
    grid-template-areas: 'name count' 'track track';
    gap: 0.15rem 0.6rem;
  }
  .st-bars { gap: 0.85rem; }
  .st-bar-name { grid-area: name; }
  .st-bar-track { grid-area: track; }
  /* The per-category volume moves into the count cell rather than vanishing: it
     was the only place the catalogue's shape by volume appeared, and phones
     lost it entirely. */
  .st-bar-count {
    grid-area: count;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    line-height: 1.3;
  }
  .st-bar-count::after {
    content: attr(data-bytes);
    font-size: 0.625rem;
    color: rgb(var(--fg-subtle));
  }
  .st-bar-bytes { display: none; }
}

/* ── rankings ─────────────────────────────────────────────────────────── */
.st-rank, .st-board { display: flex; flex-direction: column; }
.st-rank-head,
.st-rank-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) 5rem 5rem;
  align-items: center;
  gap: 0.6rem;
}
.st-rank-head {
  padding-bottom: 0.35rem;
  border-bottom: 1px solid rgb(var(--line-strong));
}
.st-rank-row, .st-board-row {
  padding: 0.4rem 0;
  border-bottom: 1px solid rgb(var(--line-default));
  font-size: 0.8125rem;
}
.st-rank-row:last-child, .st-board-row:last-child { border-bottom: 0; }
.st-rank-n {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  text-align: right;
}
.st-rank-name, .st-board-name {
  color: rgb(var(--fg-default));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.st-rank-name:hover, .st-board-name:hover { color: rgb(var(--accent-warm)); }
.st-rank-num { text-align: right; }
.st-rank-meta {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  text-align: right;
  white-space: nowrap;
}
/* Both ranking values in the same colour. The seeder count was in `--online`
   green, which `main.css` reserves for status badges and explicitly not for
   chrome — and which implied the seeder figure was "good/live" while the snatch
   count beside it was neutral, a semantic nobody intended. */
.st-rank-value, .st-board-count {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: rgb(var(--fg-muted));
  text-align: right;
  white-space: nowrap;
}
.st-board-row {
  display: grid;
  grid-template-columns: 1.5rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.6rem;
}
.st-more {
  align-self: flex-start;
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}
.st-more:hover { color: rgb(var(--accent-warm)); }
@media (max-width: 520px) {
  .st-rank-head,
  .st-rank-row { grid-template-columns: 1.5rem minmax(0, 1fr) auto; }
  .st-rank-meta { display: none; }
  .st-rank-head span:nth-child(3) { display: none; }
}

/* ── the year ─────────────────────────────────────────────────────────── */
.st-year {
  /* A real act break: a rule across the page and space above it, rather than a
     7 % tint and a slightly stronger border. */
  border-top: 1px solid rgb(var(--line-strong));
  padding-top: 1.75rem;
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.st-year-title {
  font-family: var(--font-display);
  font-size: clamp(1.25rem, 2.4vw, 1.5rem);
  font-weight: 700;
  color: rgb(var(--fg-strong));
}
.st-year-body { display: flex; flex-direction: column; gap: 1.1rem; }
/* Twelve bars at 87px wide and 88px tall is a row of squares, not a chart. */
.st-year-chart { max-width: 42rem; }
.st-year-lists {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: 1.25rem;
}
/* A heading, at heading size. `.eyebrow` at 10px uppercase was being used for
   three `h3`s, which made them smaller than the body copy they introduced — and
   `main.css` says in capitals never to do that. */
.st-sub {
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--fg-default));
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
.st-mine-best, .st-mine-cat {
  font-size: 0.8125rem;
  color: rgb(var(--fg-muted));
}
.st-mine-best a { color: rgb(var(--fg-default)); }
.st-mine-best a:hover { color: rgb(var(--accent-warm)); }
.st-mine-best-n {
  font-family: var(--font-mono);
  color: rgb(var(--fg-subtle));
  margin-left: 0.4rem;
}

.st-foot {
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
  text-align: center;
}
</style>
