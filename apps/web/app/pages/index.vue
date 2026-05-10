<template>
  <!-- =================================================================
       Homepage — "Mission control" treatment.

       Four numbered chapters laid out vertically: STATE, RELEASES,
       SWARM, MANIFESTO. Each section opens with a mono-eyebrow that
       reads like a book chapter index ("01 / 04 ─── State of the
       tracker"), so scrolling through the page feels like turning
       through a manual rather than visiting a marketing page.

       The hero pairs an oversized JetBrains Mono title (clamped
       between 3rem and ~14vw) with viewport-corner brackets and four
       huge animated counters — one per KPI. It deliberately drops the
       legacy SearchBar: the navbar now owns the search affordance and
       advertises the `/` shortcut here in a small footer line.
  ================================================================== -->
  <div class="mc">
    <!-- Ambient grid backdrop. Pure CSS — no PNG, no JS — so it scales
         to any zoom and any theme via the existing `--line-default` /
         `--accent` tokens. Sits behind the content via z-index. -->
    <div class="mc-bg" aria-hidden="true">
      <div class="mc-bg-grid" />
      <div class="mc-bg-glow" />
    </div>

    <!-- ── 01 · STATE OF THE TRACKER ──────────────────────────────── -->
    <section class="mc-chapter mc-chapter--hero" aria-labelledby="ch-state">
      <header class="mc-eyebrow">
        <span class="mc-eyebrow-num">01</span>
        <span class="mc-eyebrow-of">/ 04</span>
        <span class="mc-eyebrow-rule" aria-hidden="true" />
        <span id="ch-state" class="mc-eyebrow-name">
          {{ $t('home.section.state') }}
        </span>
        <span class="mc-eyebrow-spacer" />
        <span
          class="mc-live"
          :class="{ 'mc-live--down': trackerOnline === false }"
          :title="
            health
              ? `Tracker checked ${Math.max(
                  0,
                  Math.round((Date.now() - health.checkedAt) / 1000),
                )}s ago`
              : 'Tracker status: probing…'
          "
        >
          <span class="mc-live-dot" aria-hidden="true">
            <span class="mc-live-dot-pulse" />
            <span class="mc-live-dot-core" />
          </span>
          <span class="mc-live-label">
            {{
              trackerOnline === false
                ? $t('home.trackerOffline')
                : $t('home.live')
            }}
          </span>
          <span class="mc-clock" aria-hidden="true">{{ liveClock }}</span>
        </span>
      </header>

      <!-- Hero block — viewport corners + massive monospace title -->
      <div class="mc-hero">
        <span class="mc-hero-corner mc-hero-corner--tl" aria-hidden="true">⌜</span>
        <span class="mc-hero-corner mc-hero-corner--tr" aria-hidden="true">⌝</span>
        <span class="mc-hero-corner mc-hero-corner--bl" aria-hidden="true">⌞</span>
        <span class="mc-hero-corner mc-hero-corner--br" aria-hidden="true">⌟</span>

        <p class="mc-hero-meta">
          <span>// PRIVATE</span>
          <span class="mc-dot" aria-hidden="true" />
          <span>OPEN&nbsp;SOURCE</span>
          <span class="mc-dot" aria-hidden="true" />
          <span>ZERO&nbsp;KNOWLEDGE</span>
        </p>
        <h1
          class="mc-hero-title"
          v-html="sanitizeHtml(content?.heroTitle || displaySiteName || 'TRACKARR')"
        />
        <div
          class="mc-hero-tagline"
          v-html="sanitizeHtml(content?.heroSubtitle || $t('home.tagline'))"
        />
      </div>

      <!-- KPI strip — four oversized counters. Numbers animate from 0
           to target on first paint via `useCounter`. The protocol
           cell shows a fraction of healthy connectors. -->
      <ul class="mc-kpis">
        <li class="mc-kpi mc-kpi--accent">
          <span class="mc-kpi-num tabular-nums">{{ formatNumber(kpiTorrents) }}</span>
          <span class="mc-kpi-label">{{ $t('home.kpi.torrents') }}</span>
        </li>
        <li class="mc-kpi">
          <span class="mc-kpi-num tabular-nums">{{ formatNumber(kpiPeers) }}</span>
          <span class="mc-kpi-label">{{ $t('home.kpi.peers') }}</span>
        </li>
        <li class="mc-kpi">
          <span class="mc-kpi-num tabular-nums">{{ formatNumber(kpiSeeders) }}</span>
          <span class="mc-kpi-label">{{ $t('home.kpi.seeders') }}</span>
        </li>
        <li class="mc-kpi mc-kpi--volume">
          <span class="mc-kpi-num tabular-nums">
            {{ kpiVolumeSplit.value }}<span class="mc-kpi-unit">{{
              kpiVolumeSplit.unit
            }}</span>
          </span>
          <span class="mc-kpi-label">{{ $t('home.kpi.volume') }}</span>
        </li>
      </ul>

      <i18n-t keypath="home.tip" tag="p" class="mc-hero-tip" scope="global">
        <template #kbd>
          <kbd>/</kbd>
        </template>
      </i18n-t>
    </section>

    <!-- ── 02 · LATEST RELEASES ────────────────────────────────────── -->
    <section class="mc-chapter" aria-labelledby="ch-releases">
      <header class="mc-eyebrow">
        <span class="mc-eyebrow-num">02</span>
        <span class="mc-eyebrow-of">/ 04</span>
        <span class="mc-eyebrow-rule" aria-hidden="true" />
        <span id="ch-releases" class="mc-eyebrow-name">
          {{ $t('home.section.releases') }}
        </span>
        <span class="mc-eyebrow-spacer" />
        <NuxtLink to="/torrents" class="mc-eyebrow-link">
          {{ $t('home.browseAll') }}
          <Icon name="ph:arrow-right-bold" />
        </NuxtLink>
      </header>

      <!-- Empty state — a fresh tracker greets the operator with a
           "first-light" prompt that doubles as an upload CTA. -->
      <div v-if="recentTorrents.length === 0" class="mc-empty">
        <pre class="mc-empty-art" aria-hidden="true">─── ── ─ &nbsp;</pre>
        <p class="mc-empty-headline">{{ $t('home.ledger.empty') }}</p>
        <NuxtLink to="/torrents/upload" class="mc-empty-cta">
          {{ $t('home.ledger.uploadCta') }}
        </NuxtLink>
      </div>

      <ol v-else class="mc-ledger">
        <li class="mc-ledger-headrow" aria-hidden="true">
          <span class="mc-ledger-rank">#</span>
          <span class="mc-ledger-name">{{ $t('home.ledger.name') }}</span>
          <span class="mc-ledger-size">{{ $t('home.ledger.size') }}</span>
          <span class="mc-ledger-seed">▲</span>
          <span class="mc-ledger-leech">▼</span>
          <span class="mc-ledger-age">{{ $t('home.ledger.age') }}</span>
        </li>
        <li
          v-for="(t, i) in displayedReleases"
          :key="t.id"
          class="mc-ledger-row"
          :style="{ '--row-i': i }"
          @click="navigateTo(`/torrents/${t.infoHash}`)"
        >
          <span class="mc-ledger-rank">{{ String(i + 1).padStart(3, '0') }}</span>
          <span class="mc-ledger-name" :title="t.name">{{ t.name }}</span>
          <span class="mc-ledger-size">{{ formatSize(t.size) }}</span>
          <span class="mc-ledger-seed" :class="{ 'mc-ledger-seed--zero': !t.stats.seeders }">
            <Icon name="ph:arrow-up-bold" />
            {{ t.stats.seeders }}
          </span>
          <span class="mc-ledger-leech">
            <Icon name="ph:arrow-down-bold" />
            {{ t.stats.leechers }}
          </span>
          <span class="mc-ledger-age">{{ formatAge(t.createdAt) }}</span>
        </li>
      </ol>
    </section>

    <!-- ── 03 · SWARM SNAPSHOT ─────────────────────────────────────── -->
    <section class="mc-chapter" aria-labelledby="ch-swarm">
      <header class="mc-eyebrow">
        <span class="mc-eyebrow-num">03</span>
        <span class="mc-eyebrow-of">/ 04</span>
        <span class="mc-eyebrow-rule" aria-hidden="true" />
        <span id="ch-swarm" class="mc-eyebrow-name">
          {{ $t('home.section.swarm') }}
        </span>
      </header>

      <div class="mc-swarm">
        <!-- Tile A · Hottest — top-3 by seeders, derived from the
             same payload as the ledger so we don't pay for two fetches. -->
        <article class="mc-tile mc-tile--hot">
          <header class="mc-tile-head">
            <span class="mc-tile-mark">★</span>
            <h3>{{ $t('home.swarmTile.hottest') }}</h3>
          </header>
          <ol v-if="hottestTorrents.length > 0" class="mc-hot-list">
            <li
              v-for="(t, i) in hottestTorrents"
              :key="t.id"
              class="mc-hot-row"
              @click="navigateTo(`/torrents/${t.infoHash}`)"
            >
              <span class="mc-hot-rank">0{{ i + 1 }}</span>
              <span class="mc-hot-meta">
                <span class="mc-hot-name" :title="t.name">{{ t.name }}</span>
                <span class="mc-hot-detail">
                  <Icon name="ph:arrow-up-bold" />
                  <strong>{{ t.stats.seeders }}</strong>
                  <span class="mc-dot" aria-hidden="true" />
                  {{ formatSize(t.size) }}
                </span>
              </span>
              <span class="mc-hot-bar" aria-hidden="true">
                <span
                  class="mc-hot-bar-fill"
                  :style="{ width: hotBarWidth(t.stats.seeders) + '%' }"
                />
              </span>
            </li>
          </ol>
          <p v-else class="mc-tile-empty">
            {{ $t('home.swarmTile.hottestEmpty') }}
          </p>
        </article>

        <!-- Tile B · Protocol health — three rows, dot status. -->
        <article class="mc-tile mc-tile--proto">
          <header class="mc-tile-head">
            <span class="mc-tile-mark">⏚</span>
            <h3>{{ $t('home.swarmTile.protocols') }}</h3>
          </header>
          <ul class="mc-proto-list">
            <li
              v-for="proto in protocolRows"
              :key="proto.key"
              class="mc-proto-row"
              :class="{ 'mc-proto-row--down': !proto.up }"
            >
              <span class="mc-proto-key">{{ proto.key }}</span>
              <span class="mc-proto-bar" aria-hidden="true">
                <span class="mc-proto-bar-line" />
                <span
                  class="mc-proto-bar-blip"
                  :class="{ 'mc-proto-bar-blip--off': !proto.up }"
                />
              </span>
              <span class="mc-proto-status">
                <span class="mc-proto-dot" aria-hidden="true" />
                {{
                  proto.up
                    ? $t('home.swarmTile.protocolHealthy')
                    : $t('home.swarmTile.protocolDown')
                }}
              </span>
            </li>
          </ul>
        </article>
      </div>
    </section>

    <!-- ── 04 · MANIFESTO ──────────────────────────────────────────── -->
    <section class="mc-chapter mc-chapter--manifesto" aria-labelledby="ch-manifesto">
      <header class="mc-eyebrow">
        <span class="mc-eyebrow-num">04</span>
        <span class="mc-eyebrow-of">/ 04</span>
        <span class="mc-eyebrow-rule" aria-hidden="true" />
        <span id="ch-manifesto" class="mc-eyebrow-name">
          {{ $t('home.section.manifesto') }}
        </span>
      </header>

      <p class="mc-manifesto-lead">{{ $t('home.manifestoLead') }}</p>

      <div class="mc-manifesto-grid">
        <article
          v-for="(feature, i) in features"
          :key="i"
          class="mc-manifesto"
          :style="{ '--m-i': i }"
        >
          <span class="mc-manifesto-mark">M{{ i + 1 }}</span>
          <span class="mc-manifesto-rule" aria-hidden="true" />
          <h3
            class="mc-manifesto-title"
            v-html="sanitizeHtml(feature.title)"
          />
          <div
            class="mc-manifesto-body"
            v-html="sanitizeHtml(feature.description)"
          />
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { formatSize, formatAge } from '~/utils/format';

interface TrackerStats {
  status: string;
  cached: {
    torrents: number;
    peers: number;
    seeders: number;
    /** Sum of users.uploaded as a string — see the API for why. */
    totalUploaded: string;
    updatedAt: number;
  };
  live: {
    torrents: number;
    peers: number;
  };
  protocols: {
    http: boolean;
    udp: boolean;
    ws: boolean;
  };
}

interface TorrentWithStats {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  stats: {
    seeders: number;
    leechers: number;
    completed: number;
  };
}

interface HomepageContent {
  heroTitle: string;
  heroSubtitle: string;
  statusBadgeText: string;
  features: { title: string; description: string }[];
}

const { t } = useI18n();

useHead({ title: () => t('home.section.state') });

// ── Content fetches ─────────────────────────────────────────────────
//
// Four endpoints feed this page; all are public. We keep them parallel
// (no `await` chain) so the slowest in the bunch defines the SSR
// blocking time, not the sum.
const { data: content } = await useFetch<HomepageContent>(
  '/api/homepage-content',
);
const { data: stats } = await useFetch<TrackerStats>('/api/stats/public');
const { data: torrentsData } = await useFetch<{ data: TorrentWithStats[] }>(
  '/api/torrents',
  { query: { limit: 12 } },
);

// Branding — operator-customisable site name. We use it as the
// fallback hero headline when /api/homepage-content didn't ship one.
const { data: branding } = useFetch<{ siteName: string | null }>(
  '/api/branding',
  { lazy: true },
);
const displaySiteName = computed(() =>
  stripTags(branding.value?.siteName) || 'TRACKARR',
);

// Tracker liveness — non-blocking, optimistic on first paint, polled
// every 30s on the client. We never let the badge flap to red on a
// flaky home connection: if the API itself is unreachable we keep the
// previous status.
interface TrackerHealthPayload {
  online: boolean;
  checkedAt: number;
}
const { data: health } = useLazyFetch<TrackerHealthPayload>(
  '/api/tracker-health',
);
const trackerOnline = computed(() =>
  health.value?.online === false ? false : true,
);

if (import.meta.client) {
  const tick = setInterval(() => {
    $fetch<TrackerHealthPayload>('/api/tracker-health')
      .then((r) => {
        health.value = r;
      })
      .catch(() => {
        // Keep previous value — see comment above.
      });
  }, 30_000);
  onBeforeUnmount(() => clearInterval(tick));
}

// ── KPI counters ────────────────────────────────────────────────────
//
// We surface three numerics in the hero strip (torrents / peers /
// seeders) plus a healthy/total fraction for the four protocols. The
// counters animate from 0 → value over ~900ms on the client; on the
// server they render the final value immediately (no animation, no
// hydration mismatch).
const targetTorrents = computed(
  () => stats.value?.live?.torrents ?? stats.value?.cached?.torrents ?? 0,
);
const targetPeers = computed(
  () => stats.value?.live?.peers ?? stats.value?.cached?.peers ?? 0,
);
const targetSeeders = computed(() => stats.value?.cached?.seeders ?? 0);

const kpiTorrents = useCounter(targetTorrents);
const kpiPeers = useCounter(targetPeers);
const kpiSeeders = useCounter(targetSeeders);

// Volume — total bytes seeded across the user base. The API returns
// the value as a string to survive past `Number.MAX_SAFE_INTEGER`
// (~9 PiB); we parse it through `BigInt` and downscale to a plain
// number once we've picked the unit, so the display is precise to the
// nearest unit (KiB / MiB / …) without ever overflowing a JS Number.
//
// We don't pipe the value through `useCounter` because animating
// petabytes from 0 in a counter would (a) require BigInt arithmetic
// at 60Hz, and (b) read as visual noise — a single fade-in is more
// honest for a metric this large. The unit is split out so the CSS
// can render the suffix smaller, mirroring the `0/3` styling on the
// previous protocols cell.
const targetVolumeBytes = computed(() => {
  const raw = stats.value?.cached?.totalUploaded ?? '0';
  try {
    return BigInt(raw);
  } catch {
    return BigInt(0);
  }
});

interface VolumeParts {
  value: string;
  unit: string;
}

// Pre-built BigInt constants — using the literal syntax (`0n` / `1024n`)
// trips esbuild when the build target is ES2019 (Nitro's default for the
// SSR bundle). The `BigInt(...)` constructor is a plain runtime call, so
// it stays compatible regardless of the parse-time target.
const BIG_ZERO = BigInt(0);
const BIG_KIB = BigInt(1024);

function splitBigBytes(bytes: bigint): VolumeParts {
  if (bytes === BIG_ZERO) return { value: '0', unit: 'B' };
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  // Find the largest unit that still keeps the integer part >= 1, by
  // dividing in the BigInt domain. Past that we drop into Number land
  // for the fractional formatting — safe because we've already shaved
  // off the high-order bits.
  let i = 0;
  let scaled = bytes;
  while (scaled >= BIG_KIB && i < units.length - 1) {
    scaled = scaled / BIG_KIB;
    i++;
  }
  // Recompute the float value at the chosen unit so we keep one or
  // two decimals when relevant (`12.4 GiB` reads better than `12 GiB`).
  const floatVal = Number(bytes) / Math.pow(1024, i);
  const value = floatVal >= 100
    ? floatVal.toFixed(0)
    : floatVal >= 10
      ? floatVal.toFixed(1)
      : i === 0
        ? floatVal.toFixed(0)
        : floatVal.toFixed(2);
  return {
    value: value.replace(/\.?0+$/, ''),
    unit: units[i],
  };
}

const kpiVolumeSplit = computed<VolumeParts>(() =>
  splitBigBytes(targetVolumeBytes.value),
);

// Strict equality with `true` so an absent `protocols` field reads as
// "down" rather than "up by default". The previous `!== false` was
// optimistic — it painted every row green whenever the API was slow
// or hadn't loaded yet, which made the tile lie.
const protocolRows = computed(() => [
  { key: 'HTTP', up: stats.value?.protocols?.http === true },
  { key: 'UDP', up: stats.value?.protocols?.udp === true },
  { key: 'WS', up: stats.value?.protocols?.ws === true },
]);

// ── Releases & swarm ────────────────────────────────────────────────
const recentTorrents = computed<TorrentWithStats[]>(
  () => torrentsData.value?.data ?? [],
);

// We show 8 rows in the ledger — anything past that lives on
// /torrents proper. Eight feels right at the desktop breakpoint
// without scrolling, and it leaves enough vertical real-estate for
// the swarm + manifesto sections below the fold.
const displayedReleases = computed(() => recentTorrents.value.slice(0, 8));

const hottestTorrents = computed(() => {
  return [...recentTorrents.value]
    .sort((a, b) => (b.stats?.seeders ?? 0) - (a.stats?.seeders ?? 0))
    .slice(0, 3);
});

// Mini bar inside the hottest tile — width relative to the hottest
// torrent in view, capped at 100% so the bar never overflows. Single
// seeders read as a tiny 6% sliver, which is intentional ("present
// but quiet") rather than zero.
function hotBarWidth(seeders: number): number {
  const max = hottestTorrents.value[0]?.stats?.seeders ?? 1;
  if (max <= 0) return 0;
  const pct = Math.round((seeders / max) * 100);
  return Math.max(seeders > 0 ? 6 : 0, Math.min(100, pct));
}

// ── Live clock ──────────────────────────────────────────────────────
//
// HH:MM:SS UTC — ticks every second on the client, frozen on the
// server (we ship the SSR snapshot and let the watcher catch up post
// hydration). UTC is intentional: the operator runs the tracker in a
// data-centre context, and "21:42 UTC" reads more "command room" than
// the visitor's local time.
const liveClock = ref(formatClock(new Date()));
function formatClock(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(
    d.getUTCSeconds(),
  )} UTC`;
}
if (import.meta.client) {
  const clockTick = setInterval(() => {
    liveClock.value = formatClock(new Date());
  }, 1000);
  onBeforeUnmount(() => clearInterval(clockTick));
}

// ── Manifesto features ──────────────────────────────────────────────
const features = computed(
  () =>
    content.value?.features ?? [
      {
        title: t('home.featuresDefault.highPerf.title'),
        description: t('home.featuresDefault.highPerf.description'),
      },
      {
        title: t('home.featuresDefault.multiProtocol.title'),
        description: t('home.featuresDefault.multiProtocol.description'),
      },
      {
        title: t('home.featuresDefault.openSource.title'),
        description: t('home.featuresDefault.openSource.description'),
      },
    ],
);

function formatNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    n,
  );
}

// Counter composable — animates from 0 to a moving target over
// ~900ms with an ease-out curve. Returns a ref the template binds
// directly. On SSR / reduced-motion we skip the animation and just
// return the target value, so screen readers and motion-sensitive
// users get the data without flicker.
function useCounter(target: Ref<number>) {
  const value = ref(target.value);
  if (!import.meta.client) return value;

  const reduceMotion = window.matchMedia(
    '(prefers-reduced-motion: reduce)',
  ).matches;
  if (reduceMotion) {
    watch(target, (v) => (value.value = v), { immediate: true });
    return value;
  }

  let raf: number | null = null;
  const animate = (to: number) => {
    if (raf) cancelAnimationFrame(raf);
    const from = 0;
    const start = performance.now();
    const dur = 900;
    const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / dur);
      value.value = Math.round(from + (to - from) * easeOut(k));
      if (k < 1) raf = requestAnimationFrame(step);
      else raf = null;
    };
    raf = requestAnimationFrame(step);
  };

  watch(target, (v) => animate(v), { immediate: true });
  onBeforeUnmount(() => raf && cancelAnimationFrame(raf));
  return value;
}
</script>

<style scoped>
/* =============================================================================
 * Mission-control homepage
 *
 * All-mono typographic system (JetBrains Mono everywhere) with extreme
 * size variation. Eyebrows are numbered like book chapters (`01 / 04`)
 * and structurally repeated across all four sections. The hero pairs
 * a clamped display title with corner brackets — a viewfinder framing
 * that doubles as an instant brand signature.
 *
 * Token usage:
 *   --bg-base / -surface / -elevated   — surfaces, layered light→dark
 *   --fg-strong / -default / -muted    — text intensity steps
 *   --line-default / -strong           — borders
 *   --accent / -hover / -fg            — KPI accent + hover focus
 *   --online / -warning / -danger      — protocol status
 *
 * Animations are CSS-only and respect `prefers-reduced-motion`.
 * ============================================================================= */

.mc {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4rem;
  padding-bottom: 4rem;
}

/* ─── Background atmospherics ───────────────────────────── */
.mc-bg {
  position: absolute;
  inset: -1rem -1rem auto -1rem;
  height: 70vh;
  pointer-events: none;
  z-index: -1;
  overflow: hidden;
}
.mc-bg-grid {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(
      to right,
      rgb(var(--fg-default) / 0.04) 1px,
      transparent 1px
    ),
    linear-gradient(
      to bottom,
      rgb(var(--fg-default) / 0.04) 1px,
      transparent 1px
    );
  background-size: 56px 56px;
  mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 100%);
}
.mc-bg-glow {
  position: absolute;
  inset: -10% -10% 30% -10%;
  background: radial-gradient(
    ellipse at 50% 0%,
    rgb(var(--accent) / 0.12),
    transparent 60%
  );
}

/* ─── Eyebrow (chapter heading) ─────────────────────────── */
.mc-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}
.mc-eyebrow-num {
  color: rgb(var(--accent));
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.05em;
}
.mc-eyebrow-of {
  color: rgb(var(--fg-faint));
  font-weight: 500;
  letter-spacing: 0.05em;
}
.mc-eyebrow-rule {
  flex: 0 0 2.5rem;
  height: 1px;
  background: linear-gradient(
    to right,
    rgb(var(--fg-default) / 0.4),
    rgb(var(--fg-default) / 0)
  );
}
.mc-eyebrow-name {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.mc-eyebrow-spacer {
  flex: 1;
}
.mc-eyebrow-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: color 0.16s ease, transform 0.16s ease;
}
.mc-eyebrow-link:hover {
  color: rgb(var(--fg-strong));
  transform: translateX(2px);
}

/* ─── 01 · STATE / Hero ─────────────────────────────────── */
.mc-chapter--hero {
  padding-top: 1rem;
}

.mc-live {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.7rem 0.3rem 0.55rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-surface));
}
.mc-live--down {
  border-color: rgb(var(--danger) / 0.5);
  background: rgb(var(--danger) / 0.08);
}
.mc-live-dot {
  position: relative;
  width: 8px;
  height: 8px;
  display: inline-flex;
}
.mc-live-dot-pulse,
.mc-live-dot-core {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: rgb(var(--online));
}
.mc-live-dot-pulse {
  animation: mc-pulse 1.6s ease-out infinite;
  opacity: 0.6;
}
.mc-live--down .mc-live-dot-core,
.mc-live--down .mc-live-dot-pulse {
  background: rgb(var(--danger));
}
@keyframes mc-pulse {
  0% { transform: scale(1); opacity: 0.7; }
  70%, 100% { transform: scale(2.2); opacity: 0; }
}
.mc-live-label {
  color: rgb(var(--fg-strong));
  font-weight: 700;
  font-size: 10.5px;
  letter-spacing: 0.16em;
}
.mc-clock {
  color: rgb(var(--fg-muted));
  font-size: 10.5px;
  letter-spacing: 0;
  font-variant-numeric: tabular-nums;
}

/* Hero block — corner-bracketed viewport framing the title.
   Brackets are absolutely positioned ASCII glyphs; we keep them
   single-character so they scale with the title and never get
   replaced by an emoji font. */
.mc-hero {
  position: relative;
  padding: clamp(2.5rem, 7vw, 4.5rem) clamp(1rem, 4vw, 2.5rem);
  margin-bottom: 2rem;
}
.mc-hero-corner {
  position: absolute;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(2rem, 5vw, 3rem);
  color: rgb(var(--accent));
  line-height: 1;
  pointer-events: none;
  user-select: none;
  /* Subtle entry — corners "snap" in when the page loads */
  animation: mc-corner-in 0.6s ease both;
}
.mc-hero-corner--tl { top: 0; left: 0; animation-delay: 0.05s; }
.mc-hero-corner--tr { top: 0; right: 0; animation-delay: 0.12s; }
.mc-hero-corner--bl { bottom: 0; left: 0; animation-delay: 0.19s; }
.mc-hero-corner--br { bottom: 0; right: 0; animation-delay: 0.26s; }
@keyframes mc-corner-in {
  from { opacity: 0; transform: scale(0.6); }
  to   { opacity: 1; transform: scale(1); }
}

.mc-hero-meta {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-subtle));
  margin: 0 0 1.25rem;
}
.mc-dot {
  display: inline-block;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgb(var(--fg-faint));
}

.mc-hero-title {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 800;
  font-size: clamp(2.5rem, 11vw, 8.5rem);
  line-height: 0.92;
  letter-spacing: -0.04em;
  color: rgb(var(--fg-strong));
  word-break: break-word;
  text-transform: uppercase;
  text-shadow: 0 0 60px rgb(var(--accent) / 0.15);
  animation: mc-title-in 0.8s 0.2s ease both;
}
.mc-hero-title :deep(strong) {
  font-weight: 900;
  color: rgb(var(--accent));
}
.mc-hero-title :deep(em) {
  font-style: italic;
  color: rgb(var(--fg-muted));
  letter-spacing: -0.02em;
}
@keyframes mc-title-in {
  from { opacity: 0; transform: translateY(8px); letter-spacing: 0; }
  to   { opacity: 1; transform: translateY(0); letter-spacing: -0.04em; }
}

.mc-hero-tagline {
  margin: 1rem 0 0;
  font-family: 'Inter', system-ui, sans-serif;
  font-size: clamp(0.9rem, 1.4vw, 1.05rem);
  line-height: 1.55;
  color: rgb(var(--fg-muted));
  max-width: 56ch;
  animation: mc-fade-up 0.8s 0.4s ease both;
}
.mc-hero-tagline :deep(p) {
  margin: 0;
}
.mc-hero-tagline :deep(strong) {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.mc-hero-tagline :deep(em) {
  font-style: italic;
}
.mc-hero-tagline :deep(a) {
  color: rgb(var(--accent));
  text-decoration: underline;
  text-underline-offset: 2px;
}

@keyframes mc-fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* ─── KPI strip ─────────────────────────────────────────── */
.mc-kpis {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-surface) / 0.6);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  border-radius: 4px;
  overflow: hidden;
}
.mc-kpi {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 0.45rem;
  padding: 1.4rem 1.4rem 1.2rem;
  border-right: 1px solid rgb(var(--line-default));
  animation: mc-fade-up 0.6s ease both;
}
.mc-kpi:last-child { border-right: 0; }
.mc-kpi:nth-child(1) { animation-delay: 0.5s; }
.mc-kpi:nth-child(2) { animation-delay: 0.58s; }
.mc-kpi:nth-child(3) { animation-delay: 0.66s; }
.mc-kpi:nth-child(4) { animation-delay: 0.74s; }
/* Horizontal accent stripe under the active KPI — only the leftmost
   one gets it so the eye anchors there first. */
.mc-kpi--accent::after {
  content: '';
  position: absolute;
  inset: auto 1.4rem 0.5rem 1.4rem;
  height: 2px;
  background: rgb(var(--accent));
  border-radius: 2px;
  transform-origin: left;
  animation: mc-rule-in 0.6s 0.7s ease both;
}
@keyframes mc-rule-in {
  from { transform: scaleX(0); }
  to   { transform: scaleX(1); }
}
.mc-kpi-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 800;
  font-size: clamp(1.8rem, 4.5vw, 2.85rem);
  line-height: 1;
  letter-spacing: -0.025em;
  color: rgb(var(--fg-strong));
  font-variant-numeric: tabular-nums;
}
.mc-kpi--accent .mc-kpi-num { color: rgb(var(--accent)); }
/* Trailing unit suffix on the volume KPI (B / KiB / GiB / TiB / …).
   Smaller weight and lighter colour so the eye reads "12.4 TiB" as
   one composed value with the magnitude leading. */
.mc-kpi-unit {
  color: rgb(var(--fg-faint));
  font-weight: 500;
  font-size: 0.55em;
  letter-spacing: 0.04em;
  margin-left: 0.3rem;
  text-transform: uppercase;
}
.mc-kpi-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.mc-hero-tip {
  margin: 1.25rem 0 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  letter-spacing: 0.06em;
  color: rgb(var(--fg-faint));
}
.mc-hero-tip kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 1.1rem;
  min-width: 1.1rem;
  padding: 0 0.3rem;
  margin: 0 0.1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-weight: 700;
  font-size: 9.5px;
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-surface));
  border: 1px solid rgb(var(--line-default));
  border-radius: 3px;
}

/* ─── 02 · LEDGER (latest releases) ─────────────────────── */
.mc-ledger {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  overflow: hidden;
  background: rgb(var(--bg-surface) / 0.5);
}
.mc-ledger-headrow,
.mc-ledger-row {
  display: grid;
  grid-template-columns:
    3.25rem
    minmax(0, 1fr)
    5.5rem
    4rem
    4rem
    5rem;
  align-items: center;
  gap: 1rem;
  padding: 0.8rem 1.1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}
.mc-ledger-headrow {
  background: rgb(var(--bg-elevated) / 0.5);
  border-bottom: 1px solid rgb(var(--line-default));
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
  padding: 0.55rem 1.1rem;
}
.mc-ledger-row {
  cursor: pointer;
  border-bottom: 1px solid rgb(var(--line-default) / 0.5);
  transition: background 0.14s ease, transform 0.14s ease;
  position: relative;
  /* Stagger entry so the list "deals" itself after the hero lands. */
  animation: mc-fade-up 0.4s ease both;
  animation-delay: calc(0.1s + var(--row-i, 0) * 30ms);
}
.mc-ledger-row:last-child { border-bottom: 0; }
.mc-ledger-row::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 2px;
  background: rgb(var(--accent));
  transform: scaleY(0);
  transform-origin: center;
  transition: transform 0.18s ease;
}
.mc-ledger-row:hover {
  background: rgb(var(--bg-elevated) / 0.7);
}
.mc-ledger-row:hover::before {
  transform: scaleY(1);
}
.mc-ledger-row:hover .mc-ledger-rank {
  color: rgb(var(--accent));
}
.mc-ledger-rank {
  font-weight: 700;
  color: rgb(var(--fg-faint));
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  transition: color 0.14s ease;
}
.mc-ledger-name {
  color: rgb(var(--fg-strong));
  font-weight: 500;
  letter-spacing: -0.005em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-ledger-size {
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.mc-ledger-seed,
.mc-ledger-leech {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}
.mc-ledger-seed {
  color: rgb(var(--online));
}
.mc-ledger-seed--zero {
  color: rgb(var(--fg-muted));
}
.mc-ledger-leech {
  color: rgb(var(--fg-muted));
}
.mc-ledger-age {
  color: rgb(var(--fg-faint));
  text-align: right;
  font-size: 11px;
}

.mc-empty {
  border: 1px dashed rgb(var(--line-default));
  border-radius: 4px;
  padding: 3rem 1.5rem;
  text-align: center;
  background: rgb(var(--bg-surface) / 0.4);
}
.mc-empty-art {
  margin: 0 0 0.85rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 18px;
  letter-spacing: 0.4em;
  color: rgb(var(--fg-faint));
  white-space: pre;
}
.mc-empty-headline {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--fg-muted));
}
.mc-empty-cta {
  display: inline-block;
  margin-top: 1.25rem;
  padding: 0.55rem 1.1rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--accent-fg));
  background: rgb(var(--accent));
  border-radius: 4px;
  text-decoration: none;
  transition: background 0.16s ease;
}
.mc-empty-cta:hover {
  background: rgb(var(--accent-hover));
}

/* ─── 03 · SWARM ────────────────────────────────────────── */
.mc-swarm {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 1rem;
}
.mc-tile {
  border: 1px solid rgb(var(--line-default));
  border-radius: 4px;
  background: rgb(var(--bg-surface) / 0.5);
  padding: 1.25rem 1.25rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
  position: relative;
  overflow: hidden;
}
.mc-tile::before {
  /* Top accent stripe — only on the hot tile to mark it as "the one to
     watch". The proto tile gets the dimmer fg-default rule so the eye
     anchors on the hot list first. */
  content: '';
  position: absolute;
  inset: 0 0 auto 0;
  height: 2px;
  background: rgb(var(--fg-default) / 0.15);
}
.mc-tile--hot::before { background: rgb(var(--accent)); }
.mc-tile-head {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.mc-tile-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.4rem;
  height: 1.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  color: rgb(var(--accent));
  background: rgb(var(--accent) / 0.12);
  border-radius: 3px;
}
.mc-tile-head h3 {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.mc-tile-empty {
  margin: 0;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: rgb(var(--fg-faint));
  font-style: italic;
}

/* Hot list */
.mc-hot-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.mc-hot-row {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.8rem;
  align-items: center;
  cursor: pointer;
  transition: transform 0.14s ease;
}
.mc-hot-row:hover {
  transform: translateX(2px);
}
.mc-hot-rank {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 22px;
  font-weight: 800;
  color: rgb(var(--fg-faint));
  letter-spacing: -0.02em;
  line-height: 1;
}
.mc-hot-row:hover .mc-hot-rank {
  color: rgb(var(--accent));
}
.mc-hot-meta {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}
.mc-hot-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: rgb(var(--fg-strong));
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mc-hot-detail {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: rgb(var(--fg-muted));
}
.mc-hot-detail strong {
  color: rgb(var(--online));
  font-weight: 700;
}
.mc-hot-bar {
  grid-column: 2;
  display: block;
  height: 2px;
  background: rgb(var(--fg-default) / 0.08);
  border-radius: 2px;
  overflow: hidden;
}
.mc-hot-bar-fill {
  display: block;
  height: 100%;
  background: linear-gradient(
    to right,
    rgb(var(--accent) / 0.5),
    rgb(var(--accent))
  );
  transition: width 0.6s ease;
}

/* Protocols tile */
.mc-proto-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.mc-proto-row {
  display: grid;
  grid-template-columns: 3.5rem 1fr auto;
  gap: 0.85rem;
  align-items: center;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.mc-proto-key {
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-strong));
}
.mc-proto-row--down .mc-proto-key {
  color: rgb(var(--fg-muted));
}
.mc-proto-bar {
  position: relative;
  height: 1px;
  background: rgb(var(--line-default));
  overflow: visible;
}
.mc-proto-bar-line {
  display: block;
  height: 100%;
  background: linear-gradient(
    to right,
    rgb(var(--online) / 0.6),
    rgb(var(--online))
  );
  width: 100%;
  animation: mc-blip-line 1.4s ease both;
}
.mc-proto-row--down .mc-proto-bar-line {
  background: rgb(var(--danger) / 0.6);
}
.mc-proto-bar-blip {
  position: absolute;
  top: 50%;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--online));
  transform: translateY(-50%);
  box-shadow: 0 0 6px rgb(var(--online) / 0.7);
  animation: mc-blip-travel 2.4s linear infinite;
}
.mc-proto-bar-blip--off {
  display: none;
}
@keyframes mc-blip-line {
  from { transform: scaleX(0); transform-origin: left; }
  to   { transform: scaleX(1); }
}
@keyframes mc-blip-travel {
  0%, 100% { left: 0; opacity: 0; }
  10% { opacity: 1; }
  90% { opacity: 1; }
  50% { left: calc(100% - 6px); }
}
.mc-proto-status {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--online));
}
.mc-proto-row--down .mc-proto-status {
  color: rgb(var(--danger));
}
.mc-proto-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 3px currentColor;
  /* The shadow is so thin it reads as a halo at the small size. */
  opacity: 0.85;
}

/* ─── 04 · MANIFESTO ────────────────────────────────────── */
.mc-manifesto-lead {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 1rem;
  font-style: italic;
  color: rgb(var(--fg-muted));
  margin: 0 0 1.5rem;
  max-width: 38ch;
}
.mc-manifesto-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid rgb(var(--line-default));
  border-bottom: 1px solid rgb(var(--line-default));
}
.mc-manifesto {
  position: relative;
  padding: 1.75rem 1.5rem 1.75rem 2.25rem;
  border-right: 1px solid rgb(var(--line-default));
  animation: mc-fade-up 0.5s ease both;
  animation-delay: calc(0.1s + var(--m-i, 0) * 80ms);
}
.mc-manifesto:last-child { border-right: 0; }
.mc-manifesto::before {
  /* Vertical bar in the gutter — the editorial "marker" rail that
     anchors each principle. Slides in subtly on hover. */
  content: '';
  position: absolute;
  inset: 1.75rem auto 1.75rem 1rem;
  width: 2px;
  background: rgb(var(--fg-default) / 0.2);
  transition: background 0.18s ease;
}
.mc-manifesto:hover::before {
  background: rgb(var(--accent));
}
.mc-manifesto-mark {
  display: inline-block;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  color: rgb(var(--accent));
  margin-bottom: 0.5rem;
}
.mc-manifesto-rule {
  display: block;
  width: 1.5rem;
  height: 1px;
  background: rgb(var(--fg-default) / 0.3);
  margin: 0.5rem 0 0.85rem;
}
.mc-manifesto-title {
  margin: 0 0 0.7rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.mc-manifesto-title :deep(strong) { font-weight: 900; }
.mc-manifesto-body {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 12.5px;
  line-height: 1.6;
  color: rgb(var(--fg-muted));
}
.mc-manifesto-body :deep(p) {
  margin: 0 0 0.5rem;
}
.mc-manifesto-body :deep(p:last-child) { margin-bottom: 0; }
.mc-manifesto-body :deep(strong) {
  color: rgb(var(--fg-strong));
  font-weight: 700;
}
.mc-manifesto-body :deep(em) { font-style: italic; }
.mc-manifesto-body :deep(a) {
  color: rgb(var(--accent));
  text-decoration: underline;
  text-underline-offset: 2px;
}
.mc-manifesto-body :deep(ul),
.mc-manifesto-body :deep(ol) {
  margin: 0.5rem 0;
  padding-left: 1.25rem;
}

/* ─── Mobile reflow ─────────────────────────────────────── */
@media (max-width: 900px) {
  .mc-swarm { grid-template-columns: 1fr; }
  .mc-manifesto-grid { grid-template-columns: 1fr; border-top: 0; }
  .mc-manifesto {
    border-right: 0;
    border-top: 1px solid rgb(var(--line-default));
  }
  .mc-manifesto:first-child {
    border-top: 1px solid rgb(var(--line-default));
  }
}

@media (max-width: 720px) {
  .mc { gap: 3rem; }
  .mc-kpis {
    grid-template-columns: repeat(2, 1fr);
  }
  .mc-kpi {
    border-bottom: 1px solid rgb(var(--line-default));
  }
  .mc-kpi:nth-child(2) { border-right: 0; }
  .mc-kpi:nth-child(3),
  .mc-kpi:nth-child(4) {
    border-bottom: 0;
  }
  .mc-ledger-headrow,
  .mc-ledger-row {
    grid-template-columns: 2.5rem minmax(0, 1fr) auto;
    gap: 0.6rem;
  }
  .mc-ledger-size,
  .mc-ledger-age {
    display: none;
  }
  .mc-ledger-leech {
    /* Compact leecher count next to seeders on phones — keeps the row
       readable without making it a tall multi-line card. */
    margin-left: 0.5rem;
  }
}

@media (max-width: 480px) {
  .mc-eyebrow-link { display: none; }
  .mc-hero { padding: 2rem 1rem; }
  .mc-hero-corner { font-size: 1.5rem; }
  .mc-clock { display: none; }
}

/* Reduced motion — honour the user's preference for less movement.
   The page is functional without any animation; we just hold the
   final state from the start. */
@media (prefers-reduced-motion: reduce) {
  .mc-hero-corner,
  .mc-hero-title,
  .mc-hero-tagline,
  .mc-kpi,
  .mc-kpi--accent::after,
  .mc-ledger-row,
  .mc-manifesto,
  .mc-live-dot-pulse,
  .mc-proto-bar-line,
  .mc-proto-bar-blip {
    animation: none !important;
  }
}
</style>
