<template>
  <!--
    /mod — watchtower.

    The dashboard is built around three questions a moderator asks
    when they walk in for a shift:

      1. What needs me now?         → top stat tiles
      2. What just happened?        → activity log
      3. What's the freshest queue? → pending uploads feed

    Everything is one API call (/api/mod/dashboard) so the page
    paints fast. Numbers are tabular mono so any one moderator can
    glance across the row of stat tiles without reflow.
  -->
  <div class="wt">
    <!-- ── Top strip — eyebrow + greeting + live clock ───────── -->
    <header class="wt-head">
      <div class="wt-head-id">
        <span class="wt-eyebrow">
          <span class="wt-eyebrow-dot" :class="{ 'wt-eyebrow-dot--alert': hasAlerts }" />
          {{ $t('mod.dashboard.watchtower') }}
        </span>
        <h1 class="wt-greeting">
          {{ greetingPrefix }}<span class="wt-greeting-name">{{ data?.me?.username || '—' }}</span>
        </h1>
        <p class="wt-tagline">{{ $t('mod.dashboard.tagline') }}</p>
      </div>
      <div class="wt-clock">
        <div class="wt-clock-time tabular-nums">{{ clock }}</div>
        <div class="wt-clock-date">{{ today }}</div>
      </div>
    </header>

    <!-- ── Stat tiles — the watchtower's primary readouts ────── -->
    <section class="wt-tiles" :aria-label="$t('mod.dashboard.tilesAria')">
      <NuxtLink
        to="/mod/pending"
        class="tile tile--pending"
        :style="{ '--stagger': '0ms' }"
      >
        <span class="tile-label">{{ $t('mod.dashboard.tiles.pending') }}</span>
        <span class="tile-value tabular-nums">
          {{ formatCount(data?.counts.pendingTorrents) }}
        </span>
        <span class="tile-foot">
          <span
            v-if="(data?.counts.pendingTorrents ?? 0) > 0"
            class="tile-pulse"
            aria-hidden="true"
          />
          {{ $t('mod.dashboard.tiles.pendingHint') }}
          <Icon name="ph:arrow-up-right-bold" class="tile-arrow" />
        </span>
      </NuxtLink>

      <NuxtLink
        to="/mod/reports"
        class="tile tile--reports"
        :style="{ '--stagger': '60ms' }"
      >
        <span class="tile-label">{{ $t('mod.dashboard.tiles.reports') }}</span>
        <span class="tile-value tabular-nums">
          {{ formatCount(data?.counts.pendingReports) }}
        </span>
        <span class="tile-foot">
          <span
            v-if="(data?.counts.pendingReports ?? 0) > 0"
            class="tile-pulse"
            aria-hidden="true"
          />
          {{ $t('mod.dashboard.tiles.reportsHint') }}
          <Icon name="ph:arrow-up-right-bold" class="tile-arrow" />
        </span>
      </NuxtLink>

      <NuxtLink
        to="/mod/hnr"
        class="tile tile--hnr"
        :style="{ '--stagger': '120ms' }"
      >
        <span class="tile-label">{{ $t('mod.dashboard.tiles.hnr') }}</span>
        <span class="tile-value tabular-nums">
          {{ formatCount(data?.counts.activeHnr) }}
        </span>
        <span class="tile-foot">
          {{ $t('mod.dashboard.tiles.hnrHint') }}
          <Icon name="ph:arrow-up-right-bold" class="tile-arrow" />
        </span>
      </NuxtLink>

      <div class="tile tile--me" :style="{ '--stagger': '180ms' }">
        <span class="tile-label">{{ $t('mod.dashboard.tiles.myActions') }}</span>
        <span class="tile-value tabular-nums">
          {{ formatCount(data?.myStats.actionsThisWeek) }}
        </span>
        <span class="tile-foot">
          {{ $t('mod.dashboard.tiles.myActionsHint', { n: data?.myStats.reportsClosedThisWeek ?? 0 }) }}
        </span>
      </div>
    </section>

    <!-- ── Two-column feed: queue + activity ──────────────────── -->
    <section class="wt-feeds">
      <!-- ▤ Pending uploads (5 most recent) -->
      <article class="feed">
        <header class="feed-head">
          <div class="feed-head-id">
            <span class="feed-tag">
              <Icon name="ph:queue-bold" class="feed-tag-icon" />
              {{ $t('mod.dashboard.queue.title') }}
            </span>
            <span class="feed-meta">{{ $t('mod.dashboard.queue.meta') }}</span>
          </div>
          <NuxtLink to="/mod/pending" class="feed-cta">
            {{ $t('mod.dashboard.queue.cta') }}
            <Icon name="ph:caret-right-bold" />
          </NuxtLink>
        </header>

        <ol v-if="data?.recentPending?.length" class="feed-list">
          <li
            v-for="(t, i) in data.recentPending"
            :key="t.id"
            class="queue-row"
            :style="{ '--stagger': `${240 + i * 50}ms` }"
          >
            <span class="queue-when tabular-nums">{{ formatShortAge(t.createdAt) }}</span>
            <NuxtLink :to="`/torrents/${t.infoHash}`" class="queue-name" :title="t.name">
              {{ t.name }}
            </NuxtLink>
            <div class="queue-meta">
              <span v-if="t.uploader" class="queue-uploader">
                <Icon name="ph:user-bold" />
                {{ t.uploader.username }}
              </span>
              <span v-if="t.size" class="queue-size tabular-nums">
                {{ formatSize(t.size) }}
              </span>
              <span v-if="t.category?.name" class="queue-cat">
                {{ t.category.name }}
              </span>
            </div>
          </li>
        </ol>

        <div v-else class="feed-empty">
          <Icon name="ph:check-circle-bold" class="feed-empty-icon" />
          <span>{{ $t('mod.dashboard.queue.empty') }}</span>
        </div>
      </article>

      <!-- ▤ Activity log (10 most recent status changes) -->
      <article class="feed">
        <header class="feed-head">
          <div class="feed-head-id">
            <span class="feed-tag">
              <Icon name="ph:radio-bold" class="feed-tag-icon" />
              {{ $t('mod.dashboard.activity.title') }}
            </span>
            <span class="feed-meta">{{ $t('mod.dashboard.activity.meta') }}</span>
          </div>
        </header>

        <ol v-if="data?.recentActions?.length" class="feed-list">
          <li
            v-for="(a, i) in data.recentActions"
            :key="a.id"
            class="log-row"
            :class="`log-row--${a.statusChange}`"
            :style="{ '--stagger': `${240 + i * 35}ms` }"
          >
            <span class="log-when tabular-nums">{{ formatShortAge(a.createdAt) }}</span>
            <span class="log-actor" :title="a.author?.username || ''">
              {{ a.author?.username || $t('mod.dashboard.activity.systemActor') }}
            </span>
            <span class="log-verb">
              <Icon :name="actionIcon(a.statusChange)" class="log-verb-icon" />
              {{ actionVerb(a.statusChange) }}
            </span>
            <NuxtLink
              v-if="a.torrent"
              :to="`/torrents/${a.torrent.infoHash}`"
              class="log-target"
              :title="a.torrent.name"
            >
              {{ a.torrent.name }}
            </NuxtLink>
            <span v-else class="log-target log-target--missing">
              {{ $t('mod.dashboard.activity.deletedTarget') }}
            </span>
          </li>
        </ol>

        <div v-else class="feed-empty">
          <Icon name="ph:wave-sine-bold" class="feed-empty-icon" />
          <span>{{ $t('mod.dashboard.activity.empty') }}</span>
        </div>
      </article>
    </section>

  </div>
</template>

<script setup lang="ts">
const { t, locale } = useI18n();

definePageMeta({
  middleware: 'moderator' as any,
});

interface Counts {
  pendingTorrents: number;
  pendingReports: number;
  activeHnr: number;
}

interface MyStats {
  actionsThisWeek: number;
  reportsClosedThisWeek: number;
}

interface PendingRow {
  id: string;
  infoHash: string;
  name: string;
  size: number;
  createdAt: string;
  uploader?: { id: string; username: string } | null;
  category?: { id: string; name: string } | null;
}

interface ActionRow {
  id: string;
  statusChange: 'pending' | 'accepted' | 'changes_requested' | 'rejected' | null;
  createdAt: string;
  author?: { id: string; username: string } | null;
  torrent?: { id: string; infoHash: string; name: string } | null;
}

interface DashboardResponse {
  counts: Counts;
  myStats: MyStats;
  me: { id: string; username: string };
  recentPending: PendingRow[];
  recentActions: ActionRow[];
}

const { data } = await useFetch<DashboardResponse>('/api/mod/dashboard');

const hasAlerts = computed(() => {
  const c = data.value?.counts;
  return !!c && (c.pendingTorrents > 0 || c.pendingReports > 0);
});

// ── Greeting prefix — picks a hello based on the wall-clock hour
// so a 03:00 shift feels different from a 14:00 one.
const greetingPrefix = computed(() => {
  if (typeof window === 'undefined') return t('mod.dashboard.greeting.welcome') + ' ';
  const h = new Date().getHours();
  if (h < 5) return t('mod.dashboard.greeting.lateNight') + ' ';
  if (h < 12) return t('mod.dashboard.greeting.morning') + ' ';
  if (h < 18) return t('mod.dashboard.greeting.afternoon') + ' ';
  if (h < 22) return t('mod.dashboard.greeting.evening') + ' ';
  return t('mod.dashboard.greeting.night') + ' ';
});

// ── Live clock & today — ticks every minute so we don't waste a
// second of CPU on the watchtower while the operator is idle.
const clock = ref('');
const today = ref('');
function refreshClock() {
  const now = new Date();
  clock.value = now.toLocaleTimeString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  today.value = now.toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}
let clockInterval: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  refreshClock();
  clockInterval = setInterval(refreshClock, 30_000);
});
onBeforeUnmount(() => {
  if (clockInterval) clearInterval(clockInterval);
});

// ── Helpers ────────────────────────────────────────────────
function formatCount(n: number | undefined): string {
  if (n == null) return '–';
  return n.toString().padStart(2, '0');
}

function formatShortAge(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t('mod.dashboard.age.now');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    day: 'numeric',
    month: 'short',
  });
}

function actionIcon(status: string | null): string {
  switch (status) {
    case 'accepted':
      return 'ph:check-bold';
    case 'rejected':
      return 'ph:x-bold';
    case 'changes_requested':
      return 'ph:warning-circle-bold';
    case 'pending':
      return 'ph:hourglass-medium-bold';
    default:
      return 'ph:dot-bold';
  }
}

function actionVerb(status: string | null): string {
  switch (status) {
    case 'accepted':
      return t('mod.dashboard.activity.verbs.accepted');
    case 'rejected':
      return t('mod.dashboard.activity.verbs.rejected');
    case 'changes_requested':
      return t('mod.dashboard.activity.verbs.changesRequested');
    case 'pending':
      return t('mod.dashboard.activity.verbs.pending');
    default:
      return t('mod.dashboard.activity.verbs.acted');
  }
}
</script>

<style scoped>
/* ── Page shell ──────────────────────────────────────────── */
.wt {
  display: flex;
  flex-direction: column;
  gap: 2.25rem;
  position: relative;
}

/* Subtle dot-grid texture behind the entire watchtower — gives
   the dashboard an "instrumented control room" feel without
   committing to a full-on scanline. */
.wt::before {
  content: '';
  position: absolute;
  inset: -2rem -1rem 0;
  background-image: radial-gradient(
    circle at 1px 1px,
    rgba(212, 167, 52, 0.045) 1px,
    transparent 0
  );
  background-size: 24px 24px;
  mask-image: linear-gradient(to bottom, black 0%, transparent 75%);
  -webkit-mask-image: linear-gradient(to bottom, black 0%, transparent 75%);
  pointer-events: none;
  z-index: 0;
}

.wt > * {
  position: relative;
  z-index: 1;
}

/* ── Header strip ────────────────────────────────────────── */
.wt-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: flex-start;
  gap: 1.5rem;
  padding-bottom: 1.25rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.wt-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 88px;
  height: 1px;
  background: #d4a734;
}
.wt-head-id {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.wt-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: #d4a734;
}
.wt-eyebrow-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #6cd161;
  box-shadow: 0 0 8px rgba(108, 209, 97, 0.45);
}
.wt-eyebrow-dot--alert {
  background: #f43f5e;
  box-shadow: 0 0 10px rgba(244, 63, 94, 0.55);
  animation: wt-pulse 1.6s ease-in-out infinite;
}
@keyframes wt-pulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}
.wt-greeting {
  margin: 0;
  font-size: 1.8rem;
  font-weight: 800;
  letter-spacing: -0.015em;
  color: rgb(var(--fg-strong));
  line-height: 1.1;
}
.wt-greeting-name {
  color: #d4a734;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-weight: 700;
  font-size: 1.4rem;
  letter-spacing: 0;
  margin-left: 0.15rem;
}
.wt-tagline {
  margin: 0;
  font-size: 0.85rem;
  color: rgb(var(--fg-muted));
  max-width: 56ch;
  line-height: 1.5;
}

/* Live clock — top-right of the header strip, mono. */
.wt-clock {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.15rem;
}
.wt-clock-time {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 2rem;
  font-weight: 800;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.04em;
  line-height: 1;
}
.wt-clock-date {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Stat tiles ─────────────────────────────────────────── */
.wt-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 1rem;
}
.tile {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  padding: 1.25rem 1.25rem 1.05rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  position: relative;
  overflow: hidden;
  text-decoration: none;
  color: inherit;
  cursor: pointer;
  transition: transform 0.2s ease, border-color 0.2s ease,
    box-shadow 0.2s ease;
  animation: tile-in 0.45s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.tile::before {
  /* Coloured rail along the top edge of the tile — each bucket
     gets its own accent so the dashboard is scannable by colour
     alone. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 0;
  height: 2px;
  background: var(--tile-accent, rgb(var(--line-strong)));
}
.tile:hover:not(.tile--me) {
  transform: translateY(-2px);
  border-color: var(--tile-accent, rgb(var(--line-strong)));
  box-shadow: 0 14px 32px -22px rgba(0, 0, 0, 0.7);
}
.tile--pending { --tile-accent: #f43f5e; }
.tile--reports { --tile-accent: #d4a734; }
.tile--hnr { --tile-accent: #fb923c; }
.tile--me { --tile-accent: #6cd161; }
.tile--me { cursor: default; }

.tile-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tile-value {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 2.85rem;
  font-weight: 800;
  color: rgb(var(--fg-strong));
  line-height: 1;
  letter-spacing: -0.02em;
  margin-top: 0.1rem;
}
.tile-foot {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-top: auto;
  padding-top: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tile-accent, rgb(var(--fg-muted)));
  font-weight: 700;
}
.tile-arrow {
  font-size: 0.75rem;
  margin-left: auto;
  transition: transform 0.18s ease;
}
.tile:hover .tile-arrow {
  transform: translate(2px, -2px);
}
.tile-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--tile-accent, currentColor);
  box-shadow: 0 0 6px var(--tile-accent, currentColor);
  animation: wt-pulse 1.6s ease-in-out infinite;
}
@keyframes tile-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Feeds (two columns on desktop) ─────────────────────── */
.wt-feeds {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 900px) {
  .wt-feeds {
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
  }
}
.feed {
  display: flex;
  flex-direction: column;
  gap: 0;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
}
.feed-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.85rem 1.05rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
  flex-wrap: wrap;
}
.feed-head-id {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
}
.feed-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.feed-tag-icon {
  font-size: 1rem;
  color: #d4a734;
}
.feed-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.feed-cta {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.3rem 0.55rem;
  background: transparent;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  text-decoration: none;
  transition: all 0.16s ease;
}
.feed-cta:hover {
  color: #d4a734;
  border-color: rgba(212, 167, 52, 0.5);
}

.feed-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.feed-list > li {
  animation: feed-in 0.4s ease backwards;
  animation-delay: var(--stagger, 0ms);
}
@keyframes feed-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

/* ── Queue row (pending uploads) ─────────────────────────── */
.queue-row {
  display: grid;
  grid-template-columns: 44px minmax(0, 1fr);
  align-items: flex-start;
  gap: 0.7rem 0.85rem;
  padding: 0.7rem 1.05rem;
  border-bottom: 1px solid rgb(var(--line-default));
  transition: background 0.15s ease;
}
.queue-row:last-child { border-bottom: 0; }
.queue-row:hover {
  background: rgb(var(--bg-base));
}
.queue-when {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: #d4a734;
  padding-top: 0.15rem;
}
.queue-name {
  font-size: 0.85rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: block;
  transition: color 0.16s ease;
}
.queue-name:hover { color: #d4a734; }
.queue-meta {
  grid-column: 2;
  display: flex;
  flex-wrap: wrap;
  gap: 0.55rem 0.85rem;
  margin-top: 0.2rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.queue-uploader {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.queue-uploader svg { font-size: 0.85rem; }
.queue-cat {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 9.5px;
}

/* ── Log row (activity feed) ─────────────────────────────── */
.log-row {
  display: grid;
  grid-template-columns: 44px auto auto minmax(0, 1fr);
  align-items: center;
  gap: 0.55rem 0.7rem;
  padding: 0.55rem 1.05rem;
  border-bottom: 1px solid rgb(var(--line-default));
  transition: background 0.15s ease;
}
.log-row:last-child { border-bottom: 0; }
.log-row:hover {
  background: rgb(var(--bg-base));
}
.log-when {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.log-actor {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  white-space: nowrap;
}
.log-verb {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.2rem 0.45rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  white-space: nowrap;
}
.log-verb-icon { font-size: 0.85rem; }
.log-row--accepted .log-verb {
  color: #6cd161;
  border-color: rgba(108, 209, 97, 0.4);
  background: rgba(108, 209, 97, 0.06);
}
.log-row--rejected .log-verb {
  color: #f43f5e;
  border-color: rgba(244, 63, 94, 0.4);
  background: rgba(244, 63, 94, 0.06);
}
.log-row--changes_requested .log-verb {
  color: #fb923c;
  border-color: rgba(251, 146, 60, 0.4);
  background: rgba(251, 146, 60, 0.06);
}
.log-row--pending .log-verb {
  color: rgb(var(--fg-muted));
}
.log-target {
  font-size: 0.78rem;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  transition: color 0.16s ease;
}
.log-target:hover { color: #d4a734; }
.log-target--missing {
  font-style: italic;
  color: rgb(var(--fg-faint));
}

/* ── Empty states for the feeds ──────────────────────────── */
.feed-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  padding: 2.25rem 1rem;
  text-align: center;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.feed-empty-icon {
  font-size: 1.6rem;
  color: rgba(108, 209, 97, 0.5);
}

</style>
