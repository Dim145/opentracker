<template>
  <!--
    /mod/reports — moderation archives.

    The redesign treats each report as a numbered case file. The
    moderator scrolls a stack of dossiers, scans the target (now
    clickable when it's a torrent or user) + reason + reporter, and
    files an action. Pending dossiers carry a red wax-style stamp;
    resolved + dismissed ones get a green / grey stamp once acted on.

    Filter chips at the top show live unfiltered counts so a triage
    pass starts with one glance: "5 pending, 12 resolved, 7
    dismissed."
  -->
  <div class="archive">
    <!-- ── Eyebrow + intro ───────────────────────────────────── -->
    <header class="archive-head">
      <div class="archive-head-id">
        <span class="archive-eyebrow">
          <span class="archive-eyebrow-rule" aria-hidden="true" />
          {{ $t('admin.reports.eyebrow') }}
        </span>
        <h1 class="archive-title">{{ $t('admin.reports.title') }}</h1>
        <p class="archive-intro">{{ $t('admin.reports.intro') }}</p>
      </div>
      <span class="archive-icon" aria-hidden="true">
        <Icon name="ph:folders-bold" />
      </span>
    </header>

    <!-- ── Filter chips ──────────────────────────────────────── -->
    <nav class="filters" :aria-label="$t('admin.reports.filterAriaLabel')">
      <button
        v-for="opt in filterOptions"
        :key="opt.value"
        type="button"
        class="filter"
        :class="{
          'filter--active': statusFilter === opt.value,
          [`filter--${opt.value || 'all'}`]: true,
        }"
        @click="setFilter(opt.value)"
      >
        <span class="filter-label">{{ opt.label }}</span>
        <span class="filter-count tabular-nums">
          {{ filterCount(opt.value) }}
        </span>
      </button>
    </nav>

    <!-- ── Empty state ───────────────────────────────────────── -->
    <div v-if="!reports?.data?.length" class="empty">
      <div class="empty-stamp" aria-hidden="true">
        <Icon name="ph:check-fat-bold" />
      </div>
      <p class="empty-title">{{ $t('admin.reports.emptyTitle') }}</p>
      <p class="empty-hint">{{ emptyHint }}</p>
    </div>

    <!-- ── Case file list ────────────────────────────────────── -->
    <ul v-else class="dossiers">
      <li
        v-for="(report, index) in reports.data"
        :key="report.id"
        class="dossier"
        :class="`dossier--${report.status}`"
        :style="{ '--stagger': `${Math.min(index, 8) * 45}ms` }"
      >
        <!-- Status rail on the left edge — color signals the state
             at a glance even when the moderator is scrolling fast. -->
        <span class="dossier-rail" aria-hidden="true" />

        <!-- Header strip: case #, target type, date filed. -->
        <header class="dossier-head">
          <div class="dossier-id">
            <span class="dossier-case-label">{{ $t('admin.reports.caseLabel') }}</span>
            <code class="dossier-case-num">#{{ report.id.slice(0, 8) }}</code>
          </div>
          <div class="dossier-head-right">
            <span class="dossier-when" :title="report.createdAt">
              <Icon name="ph:clock-bold" class="dossier-when-icon" />
              {{ formatRelative(report.createdAt) }}
            </span>
            <span
              class="dossier-stamp"
              :class="`dossier-stamp--${report.status}`"
            >
              <Icon :name="stampIcon(report.status)" />
              <span>{{ statusLabel(report.status) }}</span>
            </span>
          </div>
        </header>

        <!-- Body grid: two columns on desktop (metadata + actions). -->
        <div class="dossier-body">
          <div class="dossier-meta">
            <!-- Target row — the showpiece. When the target is a
                 torrent or user, the name becomes a clickable link
                 with an inline arrow. When the target has been
                 deleted in the meantime we show a muted fallback. -->
            <div class="meta-row">
              <span class="meta-label">{{ $t('admin.reports.target') }}</span>
              <div class="meta-value">
                <span class="target-tag">
                  <Icon :name="targetIcon(report.targetType)" class="target-tag-icon" />
                  {{ targetTypeLabel(report.targetType) }}
                </span>
                <NuxtLink
                  v-if="report.target && report.target.link"
                  :to="report.target.link"
                  class="target-link"
                  :title="report.target.name"
                >
                  <span class="target-link-name">{{ report.target.name }}</span>
                  <Icon name="ph:arrow-up-right-bold" class="target-link-arrow" />
                </NuxtLink>
                <span v-else class="target-missing">
                  <Icon name="ph:warning-circle-bold" />
                  {{ $t('admin.reports.targetMissing') }}
                  <code class="target-missing-id">#{{ report.targetId.slice(0, 8) }}</code>
                </span>
              </div>
            </div>

            <!-- Reason — bold, the loudest piece of metadata. -->
            <div class="meta-row meta-row--reason">
              <span class="meta-label">{{ $t('admin.reports.reason') }}</span>
              <p class="meta-reason">{{ report.reason }}</p>
            </div>

            <!-- Optional details — operator's free-form context. -->
            <div v-if="report.details" class="meta-row">
              <span class="meta-label">{{ $t('admin.reports.details') }}</span>
              <p class="meta-details">{{ report.details }}</p>
            </div>

            <!-- Reporter — small mono caption. -->
            <div class="meta-row meta-row--inline">
              <span class="meta-label">{{ $t('admin.reports.filedBy') }}</span>
              <span class="meta-reporter">
                <Icon name="ph:user-bold" class="meta-reporter-icon" />
                <span>{{ report.reporter?.username || '—' }}</span>
              </span>
            </div>

            <!-- Resolver — only for closed cases. -->
            <div
              v-if="report.status !== 'pending' && report.resolver"
              class="meta-row meta-row--inline"
            >
              <span class="meta-label">
                {{ report.status === 'resolved'
                  ? $t('admin.reports.resolvedBy')
                  : $t('admin.reports.dismissedBy') }}
              </span>
              <span class="meta-reporter">
                <Icon name="ph:gavel-bold" class="meta-reporter-icon" />
                <span>{{ report.resolver.username }}</span>
                <span v-if="report.resolvedAt" class="meta-resolved-when">
                  · {{ formatRelative(report.resolvedAt) }}
                </span>
              </span>
            </div>

            <!-- Resolution note — moderator's reasoning. -->
            <div v-if="report.resolution" class="meta-row">
              <span class="meta-label">{{ $t('admin.reports.note') }}</span>
              <p class="meta-details meta-details--note">{{ report.resolution }}</p>
            </div>
          </div>

          <!-- Right side: action buttons for pending cases, or a
               "closed" indicator chip for the rest. -->
          <div class="dossier-actions">
            <template v-if="report.status === 'pending'">
              <button
                type="button"
                class="act act--dismiss"
                :disabled="busy === report.id"
                @click="resolveReport(report.id, 'dismissed')"
              >
                <Icon name="ph:x-bold" />
                <span>{{ $t('admin.reports.dismissAction') }}</span>
              </button>
              <button
                type="button"
                class="act act--accept"
                :disabled="busy === report.id"
                @click="resolveReport(report.id, 'resolved')"
              >
                <Icon name="ph:check-bold" />
                <span>{{ acceptLabel(report.targetType) }}</span>
              </button>
              <!-- Cascade reminder — visible only on torrent reports
                   where accepting also rejects the torrent. -->
              <p v-if="report.targetType === 'torrent'" class="act-note">
                <Icon name="ph:info-bold" />
                {{ $t('admin.reports.cascadeHint') }}
              </p>
            </template>
            <span v-else class="act-closed">
              <Icon name="ph:seal-check-bold" />
              {{ $t('admin.reports.closed') }}
            </span>
          </div>
        </div>
      </li>
    </ul>

    <!-- ── Pagination ───────────────────────────────────────── -->
    <nav
      v-if="reports?.pagination && reports.pagination.pages > 1"
      class="pager"
      :aria-label="$t('admin.reports.pagerAriaLabel')"
    >
      <button
        type="button"
        class="pager-btn"
        :disabled="page <= 1"
        @click="page--"
      >
        <Icon name="ph:caret-left-bold" />
        <span>{{ $t('admin.reports.prev') }}</span>
      </button>
      <span class="pager-state tabular-nums">
        {{ page }} <span class="pager-state-sep">/</span> {{ reports.pagination.pages }}
      </span>
      <button
        type="button"
        class="pager-btn"
        :disabled="page >= reports.pagination.pages"
        @click="page++"
      >
        <span>{{ $t('admin.reports.next') }}</span>
        <Icon name="ph:caret-right-bold" />
      </button>
    </nav>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n();
const notifications = useNotificationStore();

interface ReportTarget {
  kind: 'torrent' | 'user';
  name: string;
  link: string;
}

interface Report {
  id: string;
  reporterId: string;
  targetType: 'torrent' | 'user' | 'post' | 'comment';
  targetId: string;
  reason: string;
  details?: string | null;
  status: 'pending' | 'resolved' | 'dismissed';
  resolution?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  reporter?: { id: string; username: string } | null;
  resolver?: { id: string; username: string } | null;
  target: ReportTarget | null;
}

interface ReportsResponse {
  data: Report[];
  counts: { all: number; pending: number; resolved: number; dismissed: number };
  pagination: { page: number; limit: number; total: number; pages: number };
}

const page = ref(1);
const statusFilter = ref<'' | 'pending' | 'resolved' | 'dismissed'>('pending');
const busy = ref<string | null>(null);

const { data: reports, refresh } = await useFetch<ReportsResponse>(
  '/api/admin/reports',
  {
    query: computed(() => ({
      page: page.value,
      status: statusFilter.value || undefined,
    })),
  }
);

// ── Filter strip ───────────────────────────────────────────
const filterOptions = computed<{ value: '' | 'pending' | 'resolved' | 'dismissed'; label: string }[]>(
  () => [
    { value: 'pending', label: t('admin.reports.filterPending') },
    { value: 'resolved', label: t('admin.reports.filterResolved') },
    { value: 'dismissed', label: t('admin.reports.filterDismissed') },
    { value: '', label: t('admin.reports.filterAll') },
  ]
);

function filterCount(value: '' | 'pending' | 'resolved' | 'dismissed'): number {
  const counts = reports.value?.counts;
  if (!counts) return 0;
  if (value === '') return counts.all;
  return counts[value] ?? 0;
}

function setFilter(value: '' | 'pending' | 'resolved' | 'dismissed') {
  statusFilter.value = value;
  page.value = 1;
}

// ── Per-row helpers ────────────────────────────────────────
function statusLabel(status: 'pending' | 'resolved' | 'dismissed'): string {
  return t(`admin.reports.status.${status}`);
}

function stampIcon(status: 'pending' | 'resolved' | 'dismissed'): string {
  switch (status) {
    case 'resolved':
      return 'ph:check-fat-fill';
    case 'dismissed':
      return 'ph:x-circle-fill';
    case 'pending':
    default:
      return 'ph:hourglass-medium-fill';
  }
}

function targetIcon(type: string): string {
  switch (type) {
    case 'torrent':
      return 'ph:file-arrow-down-bold';
    case 'user':
      return 'ph:user-circle-bold';
    case 'post':
      return 'ph:chats-circle-bold';
    case 'comment':
      return 'ph:quotes-bold';
    default:
      return 'ph:question-bold';
  }
}

function targetTypeLabel(type: string): string {
  return t(`admin.reports.targets.${type}`);
}

function acceptLabel(type: string): string {
  return type === 'torrent'
    ? t('admin.reports.acceptActionTorrent')
    : t('admin.reports.acceptAction');
}

const emptyHint = computed(() => {
  if (statusFilter.value === 'pending') return t('admin.reports.emptyHintPending');
  if (statusFilter.value === 'resolved') return t('admin.reports.emptyHintResolved');
  if (statusFilter.value === 'dismissed') return t('admin.reports.emptyHintDismissed');
  return t('admin.reports.emptyHintAll');
});

// ── Relative date — lightweight, no Intl.RelativeTimeFormat ──
function formatRelative(input: string | Date): string {
  const date = typeof input === 'string' ? new Date(input) : input;
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return t('admin.reports.justNow');
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('admin.reports.minutesAgo', { n: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('admin.reports.hoursAgo', { n: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return t('admin.reports.daysAgo', { n: days });
  // Fall back to a short locale date for older entries — keeps the
  // archive scannable without flooding the row with "65 days ago".
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ── Resolve action ─────────────────────────────────────────
async function resolveReport(
  id: string,
  status: 'resolved' | 'dismissed'
) {
  if (busy.value) return;
  busy.value = id;
  try {
    await $fetch(`/api/admin/reports/${id}`, {
      method: 'PUT',
      body: { status },
    });
    notifications.success(
      status === 'resolved'
        ? t('admin.reports.toasts.resolved')
        : t('admin.reports.toasts.dismissed')
    );
    await refresh();
  } catch (error: any) {
    console.error('Failed to resolve report:', error);
    notifications.error(
      error.data?.message || t('admin.reports.toasts.failed')
    );
  } finally {
    busy.value = null;
  }
}
</script>

<style scoped>
/* ── Page shell ───────────────────────────────────────────── */
.archive {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}

/* ── Header ──────────────────────────────────────────────── */
.archive-head {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: flex-start;
  gap: 1.5rem;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.archive-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 64px;
  height: 1px;
  background: #d4a734;
}
.archive-head-id {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  min-width: 0;
}
.archive-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: #d4a734;
}
.archive-eyebrow-rule {
  display: inline-block;
  width: 26px;
  height: 1px;
  background: #d4a734;
}
.archive-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.archive-intro {
  margin: 0;
  max-width: 60ch;
  font-size: 0.85rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}
.archive-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  font-size: 1.75rem;
  color: #d4a734;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.35);
  border-radius: var(--radius-md);
  flex-shrink: 0;
}

/* ── Filter chips ────────────────────────────────────────── */
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}
.filter {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.55rem 0.9rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  cursor: pointer;
  transition: all 0.16s ease;
}
.filter:hover {
  color: rgb(var(--fg-strong));
  border-color: rgb(var(--line-strong));
}
.filter-count {
  display: inline-grid;
  place-items: center;
  min-width: 22px;
  height: 18px;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgb(var(--bg-base));
  border: 1px solid rgb(var(--line-default));
  font-size: 9.5px;
  color: rgb(var(--fg-strong));
}
/* Active states — chip takes on the colour of its bucket. */
.filter--active.filter--all {
  background: rgba(212, 167, 52, 0.1);
  border-color: rgba(212, 167, 52, 0.55);
  color: #d4a734;
}
.filter--active.filter--pending {
  background: rgba(244, 63, 94, 0.1);
  border-color: rgba(244, 63, 94, 0.55);
  color: #f43f5e;
}
.filter--active.filter--resolved {
  background: rgba(108, 209, 97, 0.1);
  border-color: rgba(108, 209, 97, 0.55);
  color: #6cd161;
}
.filter--active.filter--dismissed {
  background: rgb(var(--bg-base));
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.filter--active .filter-count {
  background: rgb(var(--bg-elevated));
  border-color: currentColor;
  color: inherit;
}

/* ── Dossier list ────────────────────────────────────────── */
.dossiers {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}
.dossier {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
  animation: dossier-in 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
  transition: border-color 0.2s ease, transform 0.2s ease,
    box-shadow 0.2s ease;
}
.dossier:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 28px -22px rgba(0, 0, 0, 0.7);
}
.dossier--pending:hover { border-color: rgba(244, 63, 94, 0.4); }
.dossier--resolved:hover { border-color: rgba(108, 209, 97, 0.35); }
.dossier--dismissed:hover { border-color: rgb(var(--line-strong)); }
@keyframes dossier-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}
/* Left status rail. */
.dossier-rail {
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 4px;
}
.dossier--pending .dossier-rail {
  background: linear-gradient(to bottom, #f43f5e 0%, rgba(244, 63, 94, 0.4) 100%);
}
.dossier--resolved .dossier-rail {
  background: linear-gradient(to bottom, #6cd161 0%, rgba(108, 209, 97, 0.4) 100%);
}
.dossier--dismissed .dossier-rail {
  background: rgb(var(--line-strong));
}

/* ── Dossier header strip ────────────────────────────────── */
.dossier-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.7rem 1rem 0.7rem 1.4rem;
  background: rgb(var(--bg-base));
  border-bottom: 1px solid rgb(var(--line-default));
  flex-wrap: wrap;
}
.dossier-id {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
}
.dossier-case-label {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.dossier-case-num {
  font-size: 11px;
  font-weight: 700;
  color: #d4a734;
  letter-spacing: 0.05em;
  background: transparent;
}
.dossier-head-right {
  display: flex;
  align-items: center;
  gap: 0.85rem;
}
.dossier-when {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}
.dossier-when-icon {
  font-size: 0.85rem;
}

/* Status stamp — the visual headliner. */
.dossier-stamp {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.32rem 0.7rem;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.dossier-stamp--pending {
  color: #f43f5e;
  background: rgba(244, 63, 94, 0.1);
  border: 1px solid rgba(244, 63, 94, 0.55);
  box-shadow: inset 0 0 0 1px rgba(244, 63, 94, 0.18);
}
.dossier-stamp--resolved {
  color: #6cd161;
  background: rgba(108, 209, 97, 0.1);
  border: 1px solid rgba(108, 209, 97, 0.55);
}
.dossier-stamp--dismissed {
  color: rgb(var(--fg-muted));
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
}

/* ── Body grid ───────────────────────────────────────────── */
.dossier-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.25rem;
  padding: 1.1rem 1.1rem 1.1rem 1.4rem;
}
@media (max-width: 720px) {
  .dossier-body {
    grid-template-columns: minmax(0, 1fr);
  }
}
.dossier-meta {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

/* ── Meta rows ───────────────────────────────────────────── */
.meta-row {
  display: grid;
  grid-template-columns: 88px 1fr;
  align-items: baseline;
  gap: 0.7rem;
  min-width: 0;
}
.meta-row--inline {
  align-items: center;
}
.meta-row--reason {
  align-items: flex-start;
}
@media (max-width: 520px) {
  .meta-row {
    grid-template-columns: 1fr;
    gap: 0.15rem;
  }
}
.meta-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-faint));
}
.meta-value {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}
.meta-reason {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 700;
  color: rgb(var(--fg-strong));
  line-height: 1.45;
  word-break: break-word;
}
.meta-details {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  line-height: 1.5;
  word-break: break-word;
  white-space: pre-wrap;
}
.meta-details--note {
  padding: 0.55rem 0.7rem;
  background: rgb(var(--bg-base));
  border-left: 2px solid rgba(212, 167, 52, 0.45);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  font-style: italic;
}
.meta-reporter {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.03em;
}
.meta-reporter-icon {
  font-size: 0.95rem;
  color: rgb(var(--fg-muted));
}
.meta-resolved-when {
  color: rgb(var(--fg-faint));
  font-size: 10px;
  margin-left: 0.1rem;
}

/* ── Target row ──────────────────────────────────────────── */
.target-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.5rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
  border: 1px solid rgb(var(--line-default));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  flex-shrink: 0;
}
.target-tag-icon {
  font-size: 0.85rem;
  color: #d4a734;
}
.target-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.55rem;
  background: rgba(212, 167, 52, 0.06);
  border: 1px solid rgba(212, 167, 52, 0.3);
  border-radius: var(--radius-sm);
  font-size: 0.84rem;
  font-weight: 600;
  color: #d4a734;
  text-decoration: none;
  transition: all 0.15s ease;
  max-width: 100%;
  min-width: 0;
}
.target-link:hover {
  background: rgba(212, 167, 52, 0.12);
  border-color: rgba(212, 167, 52, 0.55);
}
.target-link-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 36ch;
}
.target-link-arrow {
  font-size: 0.8rem;
  flex-shrink: 0;
  transition: transform 0.18s ease;
}
.target-link:hover .target-link-arrow {
  transform: translate(1px, -1px);
}
.target-missing {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.22rem 0.55rem;
  background: rgb(var(--bg-inset));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-size: 0.78rem;
  color: rgb(var(--fg-faint));
  font-style: italic;
}
.target-missing-id {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-style: normal;
  background: transparent;
}

/* ── Actions column ──────────────────────────────────────── */
.dossier-actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
  min-width: 180px;
}
@media (max-width: 720px) {
  .dossier-actions {
    align-items: stretch;
    min-width: 0;
  }
}
.act {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.55rem 0.95rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-family: inherit;
  font-size: 0.74rem;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  width: 100%;
}
.act:hover:not(:disabled) {
  transform: translateY(-1px);
}
.act:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.act--dismiss {
  color: rgb(var(--fg-muted));
}
.act--dismiss:hover:not(:disabled) {
  background: rgb(var(--bg-inset));
  border-color: rgb(var(--line-strong));
  color: rgb(var(--fg-strong));
}
.act--accept {
  background: #f43f5e;
  border-color: #f43f5e;
  color: white;
}
.act--accept:hover:not(:disabled) {
  background: #e11d48;
  border-color: #e11d48;
  box-shadow: 0 6px 18px -8px rgba(244, 63, 94, 0.5);
}
.act-note {
  margin: 0.1rem 0 0;
  display: inline-flex;
  align-items: flex-start;
  gap: 0.3rem;
  font-size: 0.7rem;
  color: rgb(var(--fg-faint));
  line-height: 1.35;
  text-align: right;
}
.act-note svg {
  font-size: 0.75rem;
  margin-top: 0.1rem;
  flex-shrink: 0;
}
.act-closed {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.5rem 0.85rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
  align-self: center;
}

/* ── Empty state ─────────────────────────────────────────── */
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 3rem 1.5rem;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
  text-align: center;
}
.empty-stamp {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(108, 209, 97, 0.08);
  border: 2px solid rgba(108, 209, 97, 0.5);
  color: #6cd161;
  font-size: 1.6rem;
  transform: rotate(-6deg);
}
.empty-title {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  max-width: 40ch;
  line-height: 1.5;
}

/* ── Pagination ──────────────────────────────────────────── */
.pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding-top: 0.5rem;
}
.pager-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.45rem 0.85rem;
  border-radius: var(--radius-sm);
  border: 1px solid rgb(var(--line-default));
  background: rgb(var(--bg-base));
  color: rgb(var(--fg-strong));
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  cursor: pointer;
  transition: all 0.15s ease;
}
.pager-btn:hover:not(:disabled) {
  border-color: rgba(212, 167, 52, 0.5);
  color: #d4a734;
}
.pager-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.pager-state {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: rgb(var(--fg-strong));
  letter-spacing: 0.05em;
}
.pager-state-sep {
  color: rgb(var(--fg-faint));
  margin: 0 0.15rem;
}
</style>
