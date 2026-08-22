<template>
  <!--
    Federation dashboard.

    The stance taken: health is not a word, it is a quantity that degrades. The
    top banner shows the time since the last run relative to the "behind"
    threshold — you read a gauge filling up, not a timestamp you have to
    subtract in your head. Below it, a colour rail per peer makes the verdict
    legible in peripheral vision, and the per-resource detail is an aligned
    monospace log, because that is what an operator actually scans: how many
    items, when, and where the cursor stands.
  -->
  <section class="card fh">
    <div class="card-header">
      <Icon name="ph:pulse-bold" />
      <span class="h-card">{{ $t('admin.federation.health.title') }}</span>
      <button
        class="fh-refresh"
        :disabled="pending"
        :title="$t('admin.federation.health.refresh')"
        @click="refresh()"
      >
        <Icon name="ph:arrows-clockwise-bold" :class="{ 'animate-spin': pending }" />
      </button>
    </div>

    <div class="card-body fh-body">
      <p v-if="!data?.enabled" class="fed-hint">
        {{ $t('admin.federation.health.disabled') }}
      </p>

      <template v-else>
        <!-- ── Heartbeat ─────────────────────────────────────────────────
             The one number anyone looks at first: how long since the last
             run, and is that worrying? -->
        <div class="fh-pulse" :class="`fh-pulse--${pulseTone}`">
          <div class="fh-pulse-head">
            <span class="fh-pulse-label">
              {{ $t('admin.federation.health.lastRun') }}
            </span>
            <span class="fh-pulse-value tabular-nums">{{ sinceLabel }}</span>
          </div>
          <div class="fh-pulse-track">
            <span class="fh-pulse-fill" :style="{ width: `${pulsePct}%` }" />
            <span class="fh-pulse-mark" />
          </div>
          <div class="fh-pulse-foot">
            <span>{{ $t('admin.federation.health.every', { d: intervalLabel }) }}</span>
            <span>{{ $t('admin.federation.health.staleAfter', { d: staleLabel }) }}</span>
          </div>
        </div>

        <!-- ── Résumé ────────────────────────────────────────────────── -->
        <div class="fh-tiles">
          <div
            v-for="t in tiles"
            :key="t.key"
            class="fh-tile"
            :class="[`fh-tile--${t.tone}`, { 'is-zero': t.n === 0 }]"
          >
            <span class="fh-tile-n tabular-nums">{{ t.n }}</span>
            <span class="fh-tile-l">{{ t.label }}</span>
          </div>
        </div>

        <!-- ── The record store ──────────────────────────────────────
             What is actually held, which appeared nowhere before: an
             operator could turn relaying on and have no way to see whether
             anything was being carried. Read left to right it is a ledger —
             what we said, what we took in, what we would pass on, and what
             has been replaced. -->
        <div class="fh-store">
          <!-- Only what exists is drawn. A segment keeps a 2px minimum so a
               tiny share stays visible, which on a zero would have painted a
               sliver standing for nothing — a bar built to be read honestly
               should not do that. The figure stays in the legend below. -->
          <div class="fh-store-bar">
            <span
              v-for="seg in storeBar.filter((s) => s.n > 0)"
              :key="seg.key"
              class="fh-seg"
              :class="`fh-seg--${seg.key}`"
              :style="{ flexGrow: seg.n }"
              :title="`${seg.label} · ${formatInt(seg.n)}`"
            />
          </div>
          <ul class="fh-store-legend">
            <li v-for="seg in storeBar" :key="seg.key" class="fh-store-item">
              <span class="fh-swatch" :class="`fh-seg--${seg.key}`" />
              <span class="fh-store-n tabular-nums">{{ formatInt(seg.n) }}</span>
              <span class="fh-store-l">{{ seg.label }}</span>
            </li>
          </ul>
          <div v-if="kinds.length" class="fh-kinds">
            <span v-for="k in kinds" :key="k.kind" class="fh-kind">
              <span class="fh-kind-k">{{ k.kind }}</span>
              <span class="fh-kind-n tabular-nums">{{ formatInt(k.n) }}</span>
            </span>
          </div>
        </div>

        <!-- ── Détail par pair ───────────────────────────────────────── -->
        <p v-if="!activePeers.length" class="fed-hint">
          {{ $t('admin.federation.health.noPeers') }}
        </p>

        <article
          v-for="peer in activePeers"
          :key="peer.id"
          class="fh-peer"
          :class="`fh-peer--${peer.verdict ?? 'never'}`"
        >
          <header class="fh-peer-head">
            <span class="fh-peer-name">
              {{ peer.displayName || hostOf(peer.baseUrl) }}
            </span>
            <span class="fh-peer-url">{{ hostOf(peer.baseUrl) }}</span>
            <!-- Two counts, deliberately side by side. The left is what we
                 hold FROM this peer — the set reconciliation compares. The
                 right is what landed in the local mirror. They differ by the
                 records that have no mirror row (tombstones, identities), so
                 a wildly wrong gap is a defect you can see rather than one
                 that quietly re-fetches forever. -->
            <span
              class="fh-peer-mirror tabular-nums"
              :title="$t('admin.federation.health.sourcedHint')"
            >
              <Icon name="ph:stack-bold" />
              {{ formatInt(peer.sourced) }}
              <span class="fh-peer-sep">/</span>
              <Icon name="ph:database-bold" />
              {{ formatInt(peer.mirrored) }}
            </span>
          </header>

          <p v-if="!peer.resources.length" class="fh-empty">
            {{ $t('admin.federation.health.neverSynced') }}
          </p>

          <ul v-else class="fh-res">
            <li v-for="r in peer.resources" :key="r.resource" class="fh-res-row">
              <span class="fh-dot" :class="`fh-dot--${r.verdict}`" />
              <span class="fh-res-name">{{ r.resource }}</span>
              <span class="fh-res-items tabular-nums">
                {{ formatInt(r.itemsSynced) }}
              </span>
              <span class="fh-res-when tabular-nums">{{ ago(r.lastRunAt) }}</span>
              <span class="fh-res-cursor" :title="r.cursor ?? ''">
                {{ r.cursor ? shortCursor(r.cursor) : '—' }}
              </span>
            </li>
          </ul>

          <!-- The error is read, not hovered: an operator diagnosing a
               problem needs the message, not a tooltip. -->
          <pre v-if="peerError(peer)" class="fh-error">{{ peerError(peer) }}</pre>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
interface Resource {
  resource: string;
  cursor: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  itemsSynced: number;
  lastError: string | null;
  verdict: 'ok' | 'stale' | 'error' | 'never';
}
interface Peer {
  id: string;
  displayName: string | null;
  baseUrl: string;
  status: string;
  active: boolean;
  lastSeenAt: string | null;
  lastError: string | null;
  mirrored: number;
  sourced: number;
  resources: Resource[];
  verdict: 'ok' | 'stale' | 'error' | 'never' | null;
}
interface Health {
  enabled: boolean;
  intervalMs: number;
  staleAfterMs: number;
  summary: {
    peersTotal: number;
    peersActive: number;
    ok: number;
    stale: number;
    error: number;
    never: number;
    mirroredTotal: number;
    records: {
      local: number;
      ingested: number;
      relayable: number;
      superseded: number;
      byKind: Record<string, number>;
    };
    lastRunAt: string | null;
  };
  peers: Peer[];
}

const { t, locale } = useI18n();
const { data, pending, refresh } = await useFetch<Health>(
  '/api/admin/federation/health',
);

/* The clock advances on its own: without this the gauge freezes at the moment of
   chargement et une page laissée ouverte ment sur l'état réel. */
const now = ref(Date.now());
let ticker: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  ticker = setInterval(() => (now.value = Date.now()), 10_000);
});
onBeforeUnmount(() => {
  if (ticker) clearInterval(ticker);
});

const activePeers = computed(() => (data.value?.peers ?? []).filter((p) => p.active));

const sinceMs = computed(() => {
  const last = data.value?.summary.lastRunAt;
  return last ? now.value - new Date(last).getTime() : null;
});

/** Gauge fill: 100% at the "behind" threshold. */
const pulsePct = computed(() => {
  const stale = data.value?.staleAfterMs ?? 0;
  if (!stale || sinceMs.value === null) return 100;
  return Math.min(100, Math.round((sinceMs.value / stale) * 100));
});
const pulseTone = computed(() => {
  if (sinceMs.value === null) return 'never';
  if (data.value?.summary.error) return 'error';
  return pulsePct.value >= 100 ? 'stale' : pulsePct.value >= 66 ? 'warn' : 'ok';
});
const sinceLabel = computed(() =>
  sinceMs.value === null
    ? t('admin.federation.health.never')
    : t('admin.federation.health.ago', { d: duration(sinceMs.value) }),
);

const intervalLabel = computed(() => duration(data.value?.intervalMs ?? 0));
const staleLabel = computed(() => duration(data.value?.staleAfterMs ?? 0));

const tiles = computed(() => {
  const s = data.value?.summary;
  return [
    { key: 'ok', n: s?.ok ?? 0, tone: 'ok', label: t('admin.federation.health.tileOk') },
    { key: 'stale', n: s?.stale ?? 0, tone: 'warn', label: t('admin.federation.health.tileStale') },
    { key: 'error', n: s?.error ?? 0, tone: 'error', label: t('admin.federation.health.tileError') },
    { key: 'mirror', n: s?.mirroredTotal ?? 0, tone: 'neutral', label: t('admin.federation.health.tileMirrored') },
  ];
});

/**
 * The store as proportional segments.
 *
 * A bar rather than four more tiles: the interesting thing about these numbers
 * is their ratio — how much of what we hold is ours, how much of what we took
 * in we would actually pass on — and a ratio is the one thing a row of figures
 * makes you compute yourself.
 */
const storeBar = computed(() => {
  const r = data.value?.summary.records;
  return [
    { key: 'local', n: r?.local ?? 0, label: t('admin.federation.health.storeLocal') },
    { key: 'ingested', n: r?.ingested ?? 0, label: t('admin.federation.health.storeIngested') },
    { key: 'relay', n: r?.relayable ?? 0, label: t('admin.federation.health.storeRelayable') },
    { key: 'old', n: r?.superseded ?? 0, label: t('admin.federation.health.storeSuperseded') },
  ];
});

/** Per kind, biggest first. A tombstone backlog should be readable as one. */
const kinds = computed(() =>
  Object.entries(data.value?.summary.records.byKind ?? {})
    .map(([kind, n]) => ({ kind, n }))
    .sort((a, b) => b.n - a.n),
);

/** The first error encountered, peer or resource — that is the blocking one. */
function peerError(p: Peer): string | null {
  return p.resources.find((r) => r.lastError)?.lastError ?? p.lastError ?? null;
}

function duration(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)} s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)} min`;
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} j`;
}
function ago(iso: string | null): string {
  if (!iso) return '—';
  return duration(Math.max(0, now.value - new Date(iso).getTime()));
}
function formatInt(n: number): string {
  return new Intl.NumberFormat(locale.value).format(n ?? 0);
}
/** A cursor is long and opaque: we show only its ends. */
function shortCursor(c: string): string {
  return c.length <= 14 ? c : `${c.slice(0, 6)}…${c.slice(-6)}`;
}
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
</script>

<style scoped>
.fh-body {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}
.fh-refresh {
  margin-left: auto;
  display: inline-flex;
  padding: 0.25rem;
  border: 0;
  border-radius: var(--radius-sm);
  background: none;
  color: rgb(var(--fg-subtle));
  cursor: pointer;
}
.fh-refresh:hover:not(:disabled) {
  color: rgb(var(--fg-strong));
  background: rgb(var(--fg-default) / 0.08);
}

/* ── Battement de cœur ───────────────────────────────────────────────── */
.fh-pulse {
  --tone: var(--online);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.85rem 1rem;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--tone));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
}
.fh-pulse--warn { --tone: var(--warning); }
.fh-pulse--stale,
.fh-pulse--error { --tone: var(--danger); }
.fh-pulse--never { --tone: var(--fg-subtle); }

.fh-pulse-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 1rem;
}
.fh-pulse-label {
  font-size: 0.68rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-muted));
}
.fh-pulse-value {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.95rem;
  color: rgb(var(--tone));
}
.fh-pulse-track {
  position: relative;
  height: 4px;
  border-radius: 999px;
  background: rgb(var(--fg-default) / 0.1);
  overflow: hidden;
}
.fh-pulse-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: rgb(var(--tone));
  transition: width 0.6s ease;
}
/* Threshold marker: the gauge has an end, and it needs to be visible. */
.fh-pulse-mark {
  position: absolute;
  inset-block: -2px;
  right: 0;
  width: 1px;
  background: rgb(var(--fg-default) / 0.35);
}
.fh-pulse-foot {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.68rem;
  color: rgb(var(--fg-subtle));
}

/* ── Tuiles de résumé ────────────────────────────────────────────────── */
.fh-tiles {
  display: grid;
  gap: 0.6rem;
  grid-template-columns: repeat(auto-fit, minmax(7rem, 1fr));
}
.fh-tile {
  --tone: var(--fg-default);
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-elevated));
}
.fh-tile--ok { --tone: var(--online); }
.fh-tile--warn { --tone: var(--warning); }
.fh-tile--error { --tone: var(--danger); }
.fh-tile-n {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 1.35rem;
  line-height: 1;
  color: rgb(var(--tone));
}
/* A counter at zero is good news: it must not shout. */
.fh-tile.is-zero .fh-tile-n { color: rgb(var(--fg-subtle)); }
.fh-tile-l {
  font-size: 0.66rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgb(var(--fg-muted));
}

/* ── Pairs ───────────────────────────────────────────────────────────── */
.fh-peer {
  --tone: var(--online);
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  padding: 0.75rem 0.9rem;
  border: 1px solid rgb(var(--line-default));
  border-left: 3px solid rgb(var(--tone));
  border-radius: var(--radius-sm);
  background: rgb(var(--bg-inset));
}
.fh-peer--stale { --tone: var(--warning); }
.fh-peer--error { --tone: var(--danger); }
.fh-peer--never { --tone: var(--fg-subtle); }

.fh-peer-head {
  display: flex;
  align-items: baseline;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.fh-peer-name {
  font-size: 0.9rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
.fh-peer-url {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.72rem;
  color: rgb(var(--fg-subtle));
}
/* ── The store ────────────────────────────────────────────────────────
   A single rule read left to right, then its key. The bar is proportional,
   so an instance carrying ten times what it publishes looks like it — no
   figure to divide in your head. */
.fh-store {
  border: 1px solid rgb(var(--border) / 0.7);
  border-radius: 0.5rem;
  padding: 0.7rem 0.8rem;
  background: rgb(var(--bg-subtle) / 0.35);
}
.fh-store-bar {
  display: flex;
  height: 6px;
  gap: 2px;
  border-radius: 3px;
  overflow: hidden;
  background: rgb(var(--border) / 0.4);
}
.fh-seg {
  min-width: 2px;
  flex-basis: 0;
  background: var(--seg);
}
/* Ours is the accent; what we carry is cooler; what we would pass on is the
   accent again, dimmed, because it IS a subset of what we carry. */
.fh-seg--local { --seg: rgb(var(--accent)); }
.fh-seg--ingested { --seg: rgb(var(--info, var(--accent)) / 0.55); }
.fh-seg--relay { --seg: rgb(var(--accent) / 0.4); }
.fh-seg--old { --seg: rgb(var(--fg-subtle) / 0.35); }
.fh-store-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1.1rem;
  margin: 0.6rem 0 0;
  padding: 0;
  list-style: none;
}
.fh-store-item {
  display: inline-flex;
  align-items: baseline;
  gap: 0.35rem;
}
.fh-swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--seg);
  transform: translateY(-1px);
}
.fh-store-n {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.8rem;
  font-weight: 600;
  color: rgb(var(--fg));
}
.fh-store-l {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: rgb(var(--fg-muted));
}
.fh-kinds {
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
  margin-top: 0.55rem;
  padding-top: 0.55rem;
  border-top: 1px dashed rgb(var(--border) / 0.6);
}
.fh-kind {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.1rem 0.4rem;
  border-radius: 0.25rem;
  background: rgb(var(--bg-subtle) / 0.8);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.68rem;
}
.fh-kind-k { color: rgb(var(--fg-muted)); }
.fh-kind-n { color: rgb(var(--fg)); font-weight: 600; }

.fh-peer-sep { color: rgb(var(--fg-subtle)); }
.fh-peer-mirror {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}

/* The log: fixed columns so the eye travels straight down. */
.fh-res {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.fh-res-row {
  display: grid;
  grid-template-columns: auto minmax(6rem, 1fr) 5rem 4rem minmax(0, 7rem);
  align-items: center;
  gap: 0.6rem;
  padding: 0.3rem 0;
  border-top: 1px solid rgb(var(--line-default) / 0.5);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.74rem;
  color: rgb(var(--fg-muted));
}
.fh-res-row:first-child { border-top: 0; }
.fh-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: rgb(var(--online));
}
.fh-dot--stale { background: rgb(var(--warning)); }
.fh-dot--error { background: rgb(var(--danger)); }
.fh-dot--never { background: rgb(var(--fg-subtle)); }
.fh-res-name { color: rgb(var(--fg-default)); }
.fh-res-items,
.fh-res-when { text-align: right; }
.fh-res-cursor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: rgb(var(--fg-subtle));
  cursor: help;
}

.fh-empty,
.fh-error {
  margin: 0;
  font-size: 0.74rem;
}
.fh-empty { color: rgb(var(--fg-subtle)); }
.fh-error {
  padding: 0.5rem 0.65rem;
  border-radius: var(--radius-sm);
  background: rgb(var(--danger) / 0.1);
  color: rgb(var(--danger));
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

@media (max-width: 40rem) {
  .fh-res-row {
    grid-template-columns: auto minmax(0, 1fr) 4rem;
  }
  .fh-res-when,
  .fh-res-cursor { display: none; }
}
</style>
