<template>
  <!--
    /admin — operations control room.

    The dashboard is a tracker-wide snapshot: live counters at the
    top, history charts in the middle, and the network plumbing
    (protocols + announce endpoints) below. Everything that ticks
    on its own (the wall clock, the relative "last refresh" label)
    is driven by a single reactive `now` so an idle dashboard
    doesn't burn CPU re-rendering.
  -->
  <div class="cr">
    <!-- ── Header strip ────────────────────────────────────────── -->
    <header class="cr-head">
      <div class="cr-head-id">
        <span class="cr-eyebrow">
          <span class="cr-eyebrow-rule" aria-hidden="true" />
          {{ $t('admin.dashboard.eyebrow') }}
        </span>
        <h1 class="cr-title">{{ $t('admin.dashboard.title') }}</h1>
        <p class="cr-intro">{{ $t('admin.dashboard.intro') }}</p>
      </div>

      <div class="cr-status" :class="`cr-status--${trackerOnline ? 'on' : 'off'}`">
        <span class="cr-status-light">
          <span class="cr-status-dot" aria-hidden="true" />
          <span class="cr-status-rings" aria-hidden="true" />
        </span>
        <div class="cr-status-text">
          <span class="cr-status-label">
            {{ trackerOnline
              ? $t('admin.dashboard.statusOnline')
              : $t('admin.dashboard.statusOffline') }}
          </span>
          <span class="cr-status-time tabular-nums">{{ wallClock }}</span>
        </div>
      </div>
    </header>

    <!-- ── Live metrics ────────────────────────────────────────── -->
    <section class="cr-section">
      <header class="cr-section-head">
        <span class="cr-section-tag">
          <Icon name="ph:gauge-bold" class="cr-section-tag-icon" />
          {{ $t('admin.dashboard.metricsTitle') }}
        </span>
        <span v-if="stats" class="cr-section-meta tabular-nums">
          {{ $t('admin.dashboard.refreshedAgo', { rel: refreshedAgo }) }}
        </span>
      </header>
      <AdminStats :stats="stats ?? undefined" />
    </section>

    <!-- ── Charts ──────────────────────────────────────────────── -->
    <section class="cr-section">
      <header class="cr-section-head">
        <span class="cr-section-tag">
          <Icon name="ph:chart-line-up-bold" class="cr-section-tag-icon" />
          {{ $t('admin.dashboard.chartsTitle') }}
        </span>
        <span v-if="history && history.length > 0" class="cr-section-meta tabular-nums">
          {{ $t('admin.dashboard.samplesCount', { n: history.length }) }}
        </span>
      </header>

      <div v-if="history && history.length > 0">
        <ClientOnly>
          <AdminCharts :history="history" />
        </ClientOnly>
      </div>
      <div v-else class="cr-empty">
        <div class="cr-empty-stamp" aria-hidden="true">
          <Icon name="ph:chart-line" />
        </div>
        <h3 class="cr-empty-title">
          {{ $t('admin.dashboard.noHistoryTitle') }}
        </h3>
        <p class="cr-empty-hint">
          {{ $t('admin.dashboard.noHistoryHint') }}
        </p>
      </div>
    </section>

    <!-- ── Protocols + endpoints (two-column) ──────────────────── -->
    <section class="cr-grid">
      <AdminProtocols :protocols="stats?.protocols" />
      <AdminEndpoints />
    </section>
  </div>
</template>

<script setup lang="ts">
interface TrackerStats {
  status: string;
  cached: {
    torrents: number;
    peers: number;
    seeders: number;
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

const { t, locale } = useI18n();

const { data: stats } = await useFetch<TrackerStats>('/api/admin/stats');
const { data: history } = await useFetch<any[]>('/api/admin/stats/history');

const trackerOnline = computed(() => stats.value?.status === 'running');

// ── Live wall clock (ticks every 30s — fast enough to keep the
// "refreshed Xm ago" label honest without being a CPU drain). ───
const now = ref(Date.now());
let tick: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  tick = setInterval(() => {
    now.value = Date.now();
  }, 30_000);
});
onBeforeUnmount(() => {
  if (tick) clearInterval(tick);
});

const wallClock = computed(() => {
  const d = new Date(now.value);
  return d.toLocaleTimeString(locale.value === 'fr' ? 'fr-FR' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
});

const refreshedAgo = computed(() => {
  const at = stats.value?.cached.updatedAt;
  if (!at) return '—';
  const seconds = Math.max(0, Math.floor((now.value - at) / 1000));
  if (seconds < 60) return t('admin.dashboard.rel.seconds', { n: seconds });
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return t('admin.dashboard.rel.minutes', { n: minutes });
  const hours = Math.floor(minutes / 60);
  return t('admin.dashboard.rel.hours', { n: hours });
});
</script>

<style scoped>
/* ── Page shell ──────────────────────────────────────────────── */
.cr {
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
  position: relative;
}

/* ── Header strip ────────────────────────────────────────────── */
.cr-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 1.5rem;
  align-items: flex-end;
  padding-bottom: 1rem;
  border-bottom: 1px solid rgb(var(--line-default));
  position: relative;
}
.cr-head::after {
  content: '';
  position: absolute;
  left: 0;
  bottom: -1px;
  width: 64px;
  height: 1px;
  background: #d4a734;
}
.cr-head-id {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
  min-width: 0;
}
.cr-eyebrow {
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
.cr-eyebrow-rule {
  display: inline-block;
  width: 26px;
  height: 1px;
  background: #d4a734;
}
.cr-title {
  margin: 0;
  font-size: 1.65rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: rgb(var(--fg-strong));
}
.cr-intro {
  margin: 0;
  max-width: 64ch;
  font-size: 0.82rem;
  line-height: 1.55;
  color: rgb(var(--fg-muted));
}

/* Status badge — green (online) / red (offline) pulse. */
.cr-status {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.9rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.cr-status--on { border-color: rgba(108, 209, 97, 0.4); }
.cr-status--off { border-color: rgba(244, 63, 94, 0.4); }
.cr-status-light {
  position: relative;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.cr-status-dot {
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: cr-pulse 1.6s ease-in-out infinite;
}
.cr-status--on .cr-status-dot {
  background: #6cd161;
  box-shadow: 0 0 10px rgba(108, 209, 97, 0.7);
}
.cr-status--off .cr-status-dot {
  background: #f43f5e;
  box-shadow: 0 0 10px rgba(244, 63, 94, 0.7);
}
@keyframes cr-pulse {
  0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(0.85); }
  50% { opacity: 1; transform: translate(-50%, -50%) scale(1.15); }
}
.cr-status-rings::before,
.cr-status-rings::after {
  content: '';
  position: absolute;
  top: 50%;
  left: 50%;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  animation: cr-ring 2.2s ease-out infinite;
  pointer-events: none;
}
.cr-status--on .cr-status-rings::before,
.cr-status--on .cr-status-rings::after {
  border: 1px solid rgba(108, 209, 97, 0.55);
}
.cr-status--off .cr-status-rings::before,
.cr-status--off .cr-status-rings::after {
  border: 1px solid rgba(244, 63, 94, 0.55);
}
.cr-status-rings::after { animation-delay: 1.1s; }
@keyframes cr-ring {
  0% { transform: translate(-50%, -50%) scale(1); opacity: 0; }
  20% { opacity: 0.7; }
  100% { transform: translate(-50%, -50%) scale(4); opacity: 0; }
}
.cr-status-text {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  line-height: 1.1;
}
.cr-status-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.2em;
  text-transform: uppercase;
}
.cr-status--on .cr-status-label { color: #6cd161; }
.cr-status--off .cr-status-label { color: #f43f5e; }
.cr-status-time {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 700;
  color: rgb(var(--fg-muted));
  letter-spacing: 0.04em;
}

/* ── Section scaffold ────────────────────────────────────────── */
.cr-section {
  display: flex;
  flex-direction: column;
  gap: 0.85rem;
}
.cr-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding-bottom: 0.45rem;
  border-bottom: 1px solid rgb(var(--line-default));
}
.cr-section-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.cr-section-tag-icon {
  font-size: 1rem;
  color: #d4a734;
}
.cr-section-meta {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}

/* ── Two-column row for protocols + endpoints ────────────────── */
.cr-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1.25rem;
}
@media (min-width: 1000px) {
  .cr-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  }
}

/* ── Empty state (no history yet) ────────────────────────────── */
.cr-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.65rem;
  padding: 3.5rem 1.5rem;
  text-align: center;
  background: rgb(var(--bg-elevated));
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-md);
}
.cr-empty-stamp {
  display: grid;
  place-items: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: rgba(212, 167, 52, 0.08);
  border: 1px solid rgba(212, 167, 52, 0.4);
  color: #d4a734;
  font-size: 1.7rem;
}
.cr-empty-title {
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-strong));
}
.cr-empty-hint {
  margin: 0;
  font-size: 0.82rem;
  color: rgb(var(--fg-muted));
  max-width: 50ch;
  line-height: 1.5;
}
</style>
