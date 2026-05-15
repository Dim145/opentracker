<template>
  <div class="reports-page">
    <!-- Decorative atmosphere — gradient mesh + grain overlay -->
    <div class="page-aura" aria-hidden="true">
      <span class="aura-blob aura-blob--a" />
      <span class="aura-blob aura-blob--b" />
      <span class="aura-grain" />
    </div>

    <!-- ── Hero header ─────────────────────────────────────────── -->
    <header class="hero">
      <div class="hero-eyebrow">
        <span class="hero-eyebrow-line" aria-hidden="true" />
        <span class="hero-number tabular-nums">{{ paddedCount(counts.all) }}</span>
        <span class="hero-of">{{ $t('reports.eyebrow') }}</span>
      </div>

      <h1 class="hero-title">
        <span class="hero-title-line hero-title-line--accent">{{ titleLine1 }}</span>
        <span class="hero-title-line hero-title-line--strong">{{ titleLine2 }}</span>
      </h1>

      <p class="hero-sub">{{ $t('reports.subtitle') }}</p>

      <!-- KPI strip — each tile clickable to filter -->
      <ul class="kpis">
        <li
          v-for="k in kpis"
          :key="k.status"
          :class="['kpi', `kpi--${k.status}`, { 'is-active': activeStatus === k.status }]"
        >
          <button type="button" class="kpi-btn" @click="setStatus(k.status)">
            <span class="kpi-num tabular-nums">{{ k.count }}</span>
            <span class="kpi-label">{{ k.label }}</span>
            <span class="kpi-rail" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </header>

    <!-- ── Active filter pill (single source of truth + clear) ──── -->
    <div class="filter-line">
      <span class="filter-line-label">{{ $t('reports.filterLineLabel') }}</span>
      <button
        v-for="tab in tabs"
        :key="tab.value"
        type="button"
        :class="['filter-pill', { 'is-active': activeStatus === tab.value }]"
        :data-status="tab.value"
        @click="setStatus(tab.value)"
      >
        <span class="filter-pill-dot" aria-hidden="true" />
        {{ tab.label }}
        <span class="filter-pill-count tabular-nums">{{ tab.count }}</span>
      </button>
    </div>

    <!-- ── Report log ──────────────────────────────────────────── -->
    <Transition name="reports-fade" mode="out-in">
      <ol v-if="rows.length > 0" :key="activeStatus" class="reports-list">
        <li
          v-for="(r, i) in rows"
          :key="r.id"
          class="report-entry"
          :data-status="r.status"
          :style="{ '--entry-delay': `${Math.min(i * 60, 700)}ms` }"
        >
          <article class="entry-card">
            <!-- Top strip: case index + timestamp + status -->
            <div class="entry-strip">
              <span class="entry-case tabular-nums">
                <span class="entry-case-prefix">№</span>
                {{ caseNumber(i) }}
              </span>
              <time class="entry-time" :datetime="r.createdAt">
                <span class="entry-time-date">{{ formatLongDate(r.createdAt) }}</span>
                <span class="entry-time-sep" aria-hidden="true">·</span>
                <span class="entry-time-clock tabular-nums">{{ formatTime(r.createdAt) }}</span>
              </time>
              <StatusChip :status="r.status" class="entry-status" />
            </div>

            <!-- Target row -->
            <div class="entry-target-row">
              <span class="entry-kind">
                <Icon :name="kindIcon(r.target?.kind || r.targetType)" />
                {{ $t(`reports.targetKind.${r.target?.kind || r.targetType}`) }}
              </span>
              <NuxtLink
                v-if="r.target && r.target.link"
                :to="r.target.link"
                class="entry-target"
                :title="r.target.name"
              >
                <span class="entry-target-name">{{ r.target.name }}</span>
                <Icon name="ph:arrow-up-right-bold" class="entry-target-icon" />
              </NuxtLink>
              <span v-else-if="r.target" class="entry-target entry-target--no-link">
                {{ r.target.name }}
              </span>
              <span v-else class="entry-target entry-target--gone">
                {{ $t('reports.targetGone') }}
              </span>
            </div>

            <!-- The reason — quoted in serif, the page's emotional centre -->
            <blockquote class="entry-reason">
              <span class="entry-reason-mark entry-reason-mark--open" aria-hidden="true">“</span>
              <span class="entry-reason-body">{{ r.reason }}</span>
              <span class="entry-reason-mark entry-reason-mark--close" aria-hidden="true">”</span>
            </blockquote>

            <p v-if="r.details" class="entry-details">{{ r.details }}</p>

            <!-- Withdraw control — only while the report is pending. Once a
                 moderator acts on it the row is part of the audit trail and
                 the user can no longer pull it back. -->
            <div v-if="r.status === 'pending'" class="entry-actions">
              <button
                type="button"
                class="entry-cancel"
                :disabled="cancellingId === r.id"
                @click="cancelReport(r)"
              >
                <Icon
                  v-if="cancellingId !== r.id"
                  name="ph:trash-bold"
                  class="entry-cancel-icon"
                />
                <Icon
                  v-else
                  name="ph:spinner-bold"
                  class="entry-cancel-icon entry-cancel-icon--spin"
                />
                {{ $t('reports.cancel.action') }}
              </button>
              <span class="entry-cancel-hint">{{ $t('reports.cancel.hint') }}</span>
            </div>

            <!-- Resolution drawer — only when the report has been actioned -->
            <div v-if="r.status !== 'pending'" class="entry-resolution">
              <div class="entry-resolution-head">
                <span
                  :class="['entry-resolution-mark', `entry-resolution-mark--${r.status}`]"
                >
                  <Icon
                    :name="r.status === 'resolved' ? 'ph:check-bold' : 'ph:x-bold'"
                  />
                </span>
                <span class="entry-resolution-meta">
                  <span class="entry-resolution-status">
                    {{ $t(`reports.status.${r.status}`) }}
                  </span>
                  <template v-if="r.resolver">
                    <span class="entry-resolution-sep">·</span>
                    {{ $t('reports.resolvedBy') }}
                    <NuxtLink
                      :to="`/users/${r.resolver.id}`"
                      class="entry-resolver-link"
                    >
                      @{{ r.resolver.username }}
                    </NuxtLink>
                  </template>
                  <template v-if="r.resolvedAt">
                    <span class="entry-resolution-sep">·</span>
                    <span class="entry-resolution-when">{{ formatRelative(r.resolvedAt) }}</span>
                  </template>
                </span>
              </div>
              <p v-if="r.resolution" class="entry-resolution-note">
                {{ r.resolution }}
              </p>
            </div>

            <!-- Status-coloured ribbon down the left edge -->
            <span class="entry-ribbon" aria-hidden="true" />
          </article>
        </li>
      </ol>

      <div v-else class="empty-state" :key="`empty-${activeStatus}`">
        <div class="empty-art" aria-hidden="true">
          <Icon name="ph:flag-banner-fold" class="empty-icon" />
          <span class="empty-art-line empty-art-line--1" />
          <span class="empty-art-line empty-art-line--2" />
          <span class="empty-art-line empty-art-line--3" />
        </div>
        <p class="empty-title">{{ emptyTitle }}</p>
        <p class="empty-sub">{{ emptySub }}</p>
      </div>
    </Transition>

    <!-- ── Pagination ──────────────────────────────────────────── -->
    <nav v-if="pagination && pagination.pages > 1" class="pager">
      <button
        type="button"
        class="pager-btn"
        :disabled="page <= 1"
        @click="page > 1 && setPage(page - 1)"
      >
        <Icon name="ph:arrow-left-bold" />
        {{ $t('reports.pager.prev') }}
      </button>
      <span class="pager-pos tabular-nums">
        <span class="pager-pos-cur">{{ page }}</span>
        <span class="pager-pos-sep">/</span>
        <span class="pager-pos-total">{{ pagination.pages }}</span>
      </span>
      <button
        type="button"
        class="pager-btn"
        :disabled="page >= pagination.pages"
        @click="page < pagination.pages && setPage(page + 1)"
      >
        {{ $t('reports.pager.next') }}
        <Icon name="ph:arrow-right-bold" />
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
import StatusChip from '~/components/reports/StatusChip.vue';

// Auth is enforced by the global `auth.global.ts` middleware —
// anonymous visitors get bounced to /auth/login before this page
// ever renders. No per-page middleware needed.
definePageMeta({ title: 'My reports' });

interface Resolver {
  id: string;
  username: string;
}
interface Target {
  kind: 'torrent' | 'user' | 'post' | 'comment';
  name: string;
  link: string | null;
}
interface ReportRow {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  resolvedAt: string | null;
  resolution: string | null;
  resolver: Resolver | null;
  target: Target | null;
  createdAt: string;
}
interface ReportsPayload {
  data: ReportRow[];
  counts: { all: number; pending: number; resolved: number; dismissed: number };
  pagination: { page: number; limit: number; total: number; pages: number };
}

const { t, locale } = useI18n();

useHead({ title: () => t('reports.title') });

type StatusFilter = 'all' | 'pending' | 'resolved' | 'dismissed';
const activeStatus = ref<StatusFilter>('all');
const page = ref(1);

const { data, refresh } = await useFetch<ReportsPayload>('/api/me/reports', {
  query: computed(() => ({
    status: activeStatus.value === 'all' ? undefined : activeStatus.value,
    page: page.value,
  })),
  default: () => ({
    data: [],
    counts: { all: 0, pending: 0, resolved: 0, dismissed: 0 },
    pagination: { page: 1, limit: 25, total: 0, pages: 0 },
  }),
});

const confirm = useConfirm();
const cancellingId = ref<string | null>(null);

async function cancelReport(r: ReportRow) {
  const ok = await confirm({
    title: t('reports.cancel.confirmTitle'),
    message: t('reports.cancel.confirmMessage'),
    confirmText: t('reports.cancel.confirmButton'),
    cancelText: t('reports.cancel.cancelButton'),
    destructive: true,
  });
  if (!ok) return;

  cancellingId.value = r.id;
  try {
    await $fetch(`/api/me/reports/${r.id}`, { method: 'DELETE' });
    await refresh();
  } catch (err) {
    // The dialog has already closed by the time the request fires, so
    // surface the failure inline rather than leaving the row hanging
    // in a "pretending to delete" state.
    console.error('[reports] cancel failed:', err);
    if (typeof window !== 'undefined') {
      window.alert(t('reports.cancel.failed'));
    }
  } finally {
    cancellingId.value = null;
  }
}

const rows = computed(() => data.value?.data ?? []);
const counts = computed(
  () => data.value?.counts ?? { all: 0, pending: 0, resolved: 0, dismissed: 0 }
);
const pagination = computed(() => data.value?.pagination);

const titleLine1 = computed(() => t('reports.titleLine1'));
const titleLine2 = computed(() => t('reports.titleLine2'));

const kpis = computed<Array<{ status: StatusFilter; count: number; label: string }>>(() => [
  { status: 'all', count: counts.value.all, label: t('reports.kpi.total') },
  { status: 'pending', count: counts.value.pending, label: t('reports.kpi.pending') },
  { status: 'resolved', count: counts.value.resolved, label: t('reports.kpi.resolved') },
  { status: 'dismissed', count: counts.value.dismissed, label: t('reports.kpi.dismissed') },
]);

const tabs = computed(() => [
  { value: 'all' as StatusFilter, label: t('reports.tab.all'), count: counts.value.all },
  { value: 'pending' as StatusFilter, label: t('reports.tab.pending'), count: counts.value.pending },
  { value: 'resolved' as StatusFilter, label: t('reports.tab.resolved'), count: counts.value.resolved },
  { value: 'dismissed' as StatusFilter, label: t('reports.tab.dismissed'), count: counts.value.dismissed },
]);

function setStatus(s: StatusFilter) {
  if (activeStatus.value === s) return;
  activeStatus.value = s;
  page.value = 1;
}

function setPage(n: number) {
  page.value = n;
  if (typeof window !== 'undefined') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

const emptyTitle = computed(() => {
  if (activeStatus.value === 'all') return t('reports.empty.allTitle');
  return t(`reports.empty.${activeStatus.value}Title`);
});
const emptySub = computed(() => {
  if (activeStatus.value === 'all') return t('reports.empty.allSub');
  return t(`reports.empty.${activeStatus.value}Sub`);
});

// ── Formatters ───────────────────────────────────────────────────
function paddedCount(n: number): string {
  return n.toString().padStart(3, '0');
}

function caseNumber(i: number): string {
  // Stable per-page case index, padded for visual rhythm.
  const baseIndex = ((page.value - 1) * 25) + i + 1;
  return baseIndex.toString().padStart(3, '0');
}

function formatLongDate(iso: string): string {
  const d = new Date(iso);
  return d
    .toLocaleDateString(locale.value, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    })
    .toUpperCase();
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = d.getHours().toString().padStart(2, '0');
  const mm = d.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t('reports.relative.now');
  if (m < 60) return t('reports.relative.minutes', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('reports.relative.hours', { n: h });
  const d = Math.floor(h / 24);
  if (d < 30) return t('reports.relative.days', { n: d });
  return new Date(iso).toLocaleDateString(locale.value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function kindIcon(kind: string): string {
  switch (kind) {
    case 'torrent':
      return 'ph:file-zip-bold';
    case 'user':
      return 'ph:user-bold';
    case 'post':
      return 'ph:chat-circle-text-bold';
    case 'comment':
      return 'ph:chat-text-bold';
    default:
      return 'ph:flag-bold';
  }
}
</script>

<style scoped>
/* ╔══════════════════════════════════════════════════════════════╗
   ║  REPORTS — case-file editorial layout                       ║
   ║  Type pairing: JetBrains Mono (meta) + Source Serif 4       ║
   ║                (quotes) + system sans (body)                ║
   ╚══════════════════════════════════════════════════════════════╝ */

.reports-page {
  position: relative;
  max-width: 1080px;
  margin: 0 auto;
  padding: 3rem 1.5rem 6rem;
  isolation: isolate;
}

/* ── Atmospheric background ────────────────────────────────────── */
.page-aura {
  position: absolute;
  inset: 0;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.aura-blob {
  position: absolute;
  display: block;
  filter: blur(80px);
  opacity: 0.35;
  border-radius: 50%;
}
.aura-blob--a {
  width: 420px;
  height: 420px;
  top: -120px;
  left: -100px;
  background: radial-gradient(circle, rgba(var(--accent), 0.6), transparent 65%);
}
.aura-blob--b {
  width: 360px;
  height: 360px;
  top: 60px;
  right: -120px;
  background: radial-gradient(circle, rgba(var(--warning), 0.45), transparent 65%);
}
.aura-grain {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px);
  background-size: 3px 3px;
  opacity: 0.6;
  mix-blend-mode: overlay;
}

/* ── Hero ──────────────────────────────────────────────────────── */
.hero {
  margin-bottom: 2.5rem;
  position: relative;
}

.hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
}
.hero-eyebrow-line {
  width: 2.5rem;
  height: 1px;
  background: linear-gradient(
    90deg,
    transparent,
    rgb(var(--accent)) 50%,
    transparent
  );
}
.hero-number {
  color: rgb(var(--accent));
  font-size: 13px;
  font-weight: 800;
}
.hero-of {
  color: rgb(var(--fg-muted));
}

.hero-title {
  margin: 0 0 0.85rem;
  display: flex;
  flex-direction: column;
  line-height: 0.95;
  letter-spacing: -0.035em;
  font-family: 'Source Serif 4', 'Charter', Georgia, serif;
}
.hero-title-line {
  display: block;
  font-size: clamp(2.5rem, 7vw, 4.5rem);
  font-weight: 800;
}
.hero-title-line--accent {
  color: rgb(var(--accent));
  font-style: italic;
  font-weight: 500;
  letter-spacing: -0.02em;
}
.hero-title-line--strong {
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(2rem, 5.5vw, 3.25rem);
  font-weight: 800;
  letter-spacing: -0.02em;
}

.hero-sub {
  font-size: 14px;
  color: rgb(var(--fg-muted));
  margin: 0 0 2rem;
  max-width: 56ch;
  line-height: 1.6;
}

/* ── KPI strip ─────────────────────────────────────────────────── */
.kpis {
  list-style: none;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 0.6rem;
  padding: 0;
  margin: 0;
}
@media (min-width: 640px) {
  .kpis { grid-template-columns: repeat(4, 1fr); }
}

.kpi {
  position: relative;
  border-radius: 0.45rem;
  overflow: hidden;
  isolation: isolate;
}
.kpi-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  width: 100%;
  padding: 1rem 1.1rem 1.05rem;
  background: rgba(var(--bg-elevated), 0.55);
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.45rem;
  color: inherit;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  transition:
    transform 0.25s cubic-bezier(0.22, 1, 0.36, 1),
    background-color 0.2s ease,
    border-color 0.2s ease;
}
.kpi-btn:hover {
  background: rgba(var(--bg-elevated), 0.85);
  border-color: rgba(var(--fg-default), 0.25);
  transform: translateY(-1px);
}
.kpi.is-active .kpi-btn {
  background: rgba(var(--bg-elevated), 0.95);
  border-color: rgba(var(--rail, var(--accent)), 0.55);
  box-shadow: 0 8px 24px -16px rgba(var(--rail, var(--accent)), 0.65);
}

.kpi-rail {
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: rgb(var(--rail, var(--fg-muted)));
  opacity: 0.85;
  transition: width 0.2s ease, opacity 0.2s ease;
}
.kpi-btn:hover .kpi-rail,
.kpi.is-active .kpi-rail { width: 4px; opacity: 1; }

.kpi--all { --rail: var(--accent); }
.kpi--pending { --rail: var(--warning); }
.kpi--resolved { --rail: var(--online); }
.kpi--dismissed { --rail: var(--danger); }

.kpi-num {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: clamp(1.6rem, 3.4vw, 2.1rem);
  font-weight: 800;
  letter-spacing: -0.03em;
  color: rgb(var(--fg-strong));
  line-height: 1;
  margin-bottom: 0.5rem;
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
}
.kpi-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Filter line ───────────────────────────────────────────────── */
.filter-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem 0.75rem;
  margin: 2rem 0 1.75rem;
  padding-top: 1.25rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.filter-line-label {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  margin-right: 0.5rem;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.85rem;
  background: rgba(var(--bg-elevated), 0.45);
  border: 1px solid rgb(var(--line-default));
  border-radius: 999px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: color 0.15s, background-color 0.2s, border-color 0.2s, transform 0.2s,
              box-shadow 0.2s;
}
.filter-pill:hover {
  color: rgb(var(--fg-strong));
  background: rgba(var(--bg-elevated), 0.7);
  transform: translateY(-1px);
}
/* Active state — translucent fill in the pill's own colour. Avoids
   the bg-primary/accent inversion that disappears in high-contrast
   themes (e.g. a white accent on a near-white --bg-base). */
.filter-pill.is-active {
  color: rgb(var(--pill-tint, var(--accent)));
  background: rgba(var(--pill-tint, var(--accent)), 0.16);
  border-color: rgba(var(--pill-tint, var(--accent)), 0.55);
  box-shadow: 0 6px 18px -10px rgba(var(--pill-tint, var(--accent)), 0.55);
}

/* Each tab carries its own status tint so the active pill matches
   the colour the cards use further down the page. */
.filter-pill[data-status='all'] { --pill-tint: var(--accent); }
.filter-pill[data-status='pending'] { --pill-tint: var(--warning); }
.filter-pill[data-status='resolved'] { --pill-tint: var(--online); }
.filter-pill[data-status='dismissed'] { --pill-tint: var(--danger); }

.filter-pill-dot {
  width: 5px;
  height: 5px;
  border-radius: 999px;
  background: currentColor;
  opacity: 0.4;
  transition: opacity 0.15s, transform 0.2s;
}
.filter-pill.is-active .filter-pill-dot {
  opacity: 1;
  transform: scale(1.2);
}

.filter-pill-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.25rem;
  padding: 0.05rem 0.4rem;
  border-radius: 999px;
  font-size: 9.5px;
  font-weight: 700;
  background: rgba(var(--fg-default), 0.08);
}
.filter-pill.is-active .filter-pill-count {
  background: rgba(var(--pill-tint, var(--accent)), 0.22);
}

/* ── Report list ───────────────────────────────────────────────── */
.reports-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.report-entry {
  animation: entryRise 0.65s cubic-bezier(0.22, 1, 0.36, 1) both;
  animation-delay: var(--entry-delay, 0ms);
}
@keyframes entryRise {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

/* The card — everything lives inside it, including a vertical
   coloured ribbon on the left that signals status at a glance. */
.entry-card {
  position: relative;
  background: rgba(var(--bg-elevated), 0.42);
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.55rem;
  padding: 1.15rem 1.4rem 1.25rem 1.65rem;
  overflow: hidden;
  transition:
    background-color 0.25s ease,
    border-color 0.25s ease,
    transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.entry-card:hover {
  background: rgba(var(--bg-elevated), 0.62);
  border-color: rgba(var(--fg-default), 0.22);
  transform: translateY(-1px);
}
.entry-card:hover .entry-ribbon { width: 6px; }

.entry-ribbon {
  position: absolute;
  inset: 0 auto 0 0;
  width: 4px;
  background: rgb(var(--rail, var(--fg-muted)));
  transition: width 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.report-entry[data-status='pending']  { --rail: var(--warning); }
.report-entry[data-status='resolved'] { --rail: var(--online); }
.report-entry[data-status='dismissed']{ --rail: var(--danger); }

/* Top strip — case number, timestamp, status */
.entry-strip {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-wrap: wrap;
  margin-bottom: 0.95rem;
  padding-bottom: 0.7rem;
  border-bottom: 1px dashed rgb(var(--line-default));
}

.entry-case {
  display: inline-flex;
  align-items: baseline;
  gap: 0.18rem;
  padding: 0.2rem 0.45rem;
  border: 1px solid rgba(var(--rail), 0.4);
  background: rgba(var(--rail), 0.08);
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: rgb(var(--rail, var(--accent)));
}
.entry-case-prefix {
  font-size: 9.5px;
  opacity: 0.7;
}

.entry-time {
  display: inline-flex;
  align-items: baseline;
  gap: 0.45rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
}
.entry-time-date {
  color: rgb(var(--fg-default));
  font-weight: 700;
  letter-spacing: 0.14em;
}
.entry-time-sep { opacity: 0.5; }
.entry-time-clock { color: rgb(var(--fg-faint)); }

.entry-status { margin-left: auto; }

/* Target row */
.entry-target-row {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  flex-wrap: wrap;
  margin-bottom: 0.85rem;
}

.entry-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.55rem;
  border: 1px solid rgb(var(--line-default));
  background: rgba(var(--bg-surface), 0.55);
  border-radius: 0.25rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

.entry-target {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 16px;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  text-decoration: none;
  transition: color 0.15s ease;
  max-width: 100%;
  overflow: hidden;
  position: relative;
}
.entry-target-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 50ch;
  position: relative;
  background-image: linear-gradient(currentColor, currentColor);
  background-size: 0% 1px;
  background-position: 0 100%;
  background-repeat: no-repeat;
  transition: background-size 0.25s cubic-bezier(0.22, 1, 0.36, 1);
}
.entry-target:hover .entry-target-name {
  color: rgb(var(--accent));
  background-size: 100% 1px;
}
.entry-target-icon {
  font-size: 0.85em;
  opacity: 0.5;
  transition: opacity 0.15s, transform 0.2s;
  flex-shrink: 0;
}
.entry-target:hover .entry-target-icon {
  opacity: 1;
  transform: translate(2px, -2px);
}
.entry-target--no-link {
  color: rgb(var(--fg-default));
  cursor: default;
}
.entry-target--gone {
  color: rgb(var(--fg-faint));
  font-style: italic;
  font-weight: 400;
}

/* Reason — quoted in editorial serif italic */
.entry-reason {
  position: relative;
  margin: 0;
  padding: 0.65rem 1rem 0.65rem 1rem;
  font-family: 'Source Serif 4', 'Charter', Georgia, serif;
  font-size: 16.5px;
  font-style: italic;
  font-weight: 400;
  line-height: 1.55;
  color: rgb(var(--fg-default));
  background:
    linear-gradient(
      90deg,
      rgba(var(--rail, var(--fg-muted)), 0.08),
      transparent 70%
    );
  border-left: 2px solid rgb(var(--rail, var(--fg-muted)));
  border-radius: 0 0.25rem 0.25rem 0;
}
.entry-reason-mark {
  display: inline-block;
  font-family: 'Source Serif 4', 'Charter', Georgia, serif;
  font-size: 1.6em;
  font-weight: 700;
  line-height: 0;
  color: rgb(var(--rail, var(--fg-muted)));
  opacity: 0.7;
  vertical-align: -0.15em;
}
.entry-reason-mark--open { margin-right: 0.15em; }
.entry-reason-mark--close { margin-left: 0.05em; }
.entry-reason-body { display: inline; }

.entry-details {
  margin: 0.75rem 0 0;
  padding-left: 1rem;
  font-size: 13.5px;
  color: rgb(var(--fg-muted));
  line-height: 1.65;
  border-left: 1px solid rgba(var(--rail, var(--fg-muted)), 0.25);
}

/* ── Withdraw control (pending only) ──────────────────────────── */
.entry-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin-top: 1.05rem;
  padding-top: 0.85rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.entry-cancel {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.4rem 0.85rem;
  background: transparent;
  border: 1px solid rgba(var(--danger), 0.4);
  border-radius: 0.3rem;
  color: rgb(var(--danger));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease,
    transform 0.2s cubic-bezier(0.22, 1, 0.36, 1);
}
.entry-cancel:hover:not(:disabled) {
  background: rgba(var(--danger), 0.12);
  border-color: rgba(var(--danger), 0.7);
  transform: translateY(-1px);
}
.entry-cancel:disabled {
  opacity: 0.55;
  cursor: progress;
}
.entry-cancel-icon { font-size: 0.95em; }
.entry-cancel-icon--spin { animation: cancelSpin 0.9s linear infinite; }
@keyframes cancelSpin {
  to { transform: rotate(360deg); }
}
.entry-cancel-hint {
  font-size: 12px;
  color: rgb(var(--fg-faint));
  font-style: italic;
  line-height: 1.45;
  max-width: 38ch;
}

/* Resolution block */
.entry-resolution {
  margin-top: 1.05rem;
  padding-top: 0.85rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.entry-resolution-head {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.entry-resolution-mark {
  width: 1.5rem;
  height: 1.5rem;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85em;
  background: rgba(var(--rail), 0.15);
  color: rgb(var(--rail));
  flex-shrink: 0;
}
.entry-resolution-mark--resolved {
  background: rgba(var(--online), 0.15);
  color: rgb(var(--online));
}
.entry-resolution-mark--dismissed {
  background: rgba(var(--danger), 0.15);
  color: rgb(var(--danger));
}
.entry-resolution-meta {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.3rem;
}
.entry-resolution-status {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  color: rgb(var(--fg-default));
}
.entry-resolution-sep { opacity: 0.45; }
.entry-resolution-when { color: rgb(var(--fg-faint)); }

.entry-resolver-link {
  color: rgb(var(--fg-default));
  text-decoration: none;
  font-weight: 700;
  transition: color 0.15s ease;
  border-bottom: 1px dashed rgba(var(--fg-default), 0.25);
}
.entry-resolver-link:hover {
  color: rgb(var(--accent));
  border-bottom-color: rgb(var(--accent));
}

.entry-resolution-note {
  margin: 0.75rem 0 0;
  padding: 0.75rem 1rem;
  background: rgba(var(--bg-surface), 0.6);
  border-left: 3px solid rgba(var(--rail), 0.45);
  border-radius: 0 0.25rem 0.25rem 0;
  font-family: 'Source Serif 4', 'Charter', Georgia, serif;
  font-size: 13.5px;
  font-style: italic;
  color: rgb(var(--fg-default));
  line-height: 1.6;
}

/* ── Empty state ───────────────────────────────────────────────── */
.empty-state {
  text-align: center;
  padding: 5rem 1.5rem;
  color: rgb(var(--fg-muted));
}
.empty-art {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 5rem;
  height: 5rem;
  margin: 0 auto 1.5rem;
  border-radius: 999px;
  background: rgba(var(--bg-elevated), 0.5);
  border: 1px dashed rgb(var(--line-default));
}
.empty-icon {
  font-size: 2.25rem;
  color: rgb(var(--fg-faint));
}
.empty-art-line {
  position: absolute;
  height: 1px;
  background: rgb(var(--line-default));
}
.empty-art-line--1 {
  width: 40px; left: -55px; top: 50%;
  background: linear-gradient(90deg, transparent, rgb(var(--line-default)));
}
.empty-art-line--2 {
  width: 40px; right: -55px; top: 50%;
  background: linear-gradient(90deg, rgb(var(--line-default)), transparent);
}
.empty-art-line--3 {
  width: 30px; left: 50%; top: -25px;
  transform: translateX(-50%);
  background: linear-gradient(0deg, rgb(var(--line-default)), transparent);
  height: 25px;
  width: 1px;
}
.empty-title {
  font-family: 'Source Serif 4', 'Charter', Georgia, serif;
  font-size: 1.35rem;
  font-style: italic;
  font-weight: 600;
  color: rgb(var(--fg-strong));
  margin: 0 0 0.5rem;
}
.empty-sub {
  font-size: 13.5px;
  color: rgb(var(--fg-muted));
  margin: 0;
  max-width: 42ch;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.55;
}

/* ── Pager ─────────────────────────────────────────────────────── */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1.25rem;
  margin-top: 3rem;
  padding-top: 2rem;
  border-top: 1px dashed rgb(var(--line-default));
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 1.05rem;
  background: rgba(var(--bg-elevated), 0.45);
  border: 1px solid rgb(var(--line-default));
  border-radius: 0.3rem;
  color: rgb(var(--fg-default));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  cursor: pointer;
  transition: background-color 0.2s, border-color 0.2s, transform 0.15s;
}
.pager-btn:hover:not(:disabled) {
  background: rgba(var(--bg-elevated), 0.75);
  border-color: rgba(var(--fg-default), 0.25);
  transform: translateY(-1px);
}
.pager-btn:disabled { opacity: 0.35; cursor: not-allowed; }
.pager-pos {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
}
.pager-pos-cur { color: rgb(var(--fg-strong)); font-size: 16px; }
.pager-pos-sep { opacity: 0.4; }

/* ── Transitions ───────────────────────────────────────────────── */
.reports-fade-enter-active,
.reports-fade-leave-active {
  transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
}
.reports-fade-enter-from,
.reports-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}

/* ── Responsive ────────────────────────────────────────────────── */
@media (max-width: 640px) {
  .reports-page { padding: 2rem 1rem 4rem; }
  .entry-strip { gap: 0.55rem; }
  .entry-status {
    margin-left: 0;
    order: 3;
    width: 100%;
  }
  .entry-time-date {
    letter-spacing: 0.1em;
  }
  .entry-target-name {
    max-width: 28ch;
  }
}
</style>
