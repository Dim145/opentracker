<template>
  <!--
    Live-metrics readout grid for the /admin dashboard. Four tiles
    each carry a coloured rail on the top edge — torrents (gold),
    peers (white), seeders (green), leechers (amber) — so the
    operator can scan the whole row by colour alone. Numbers are
    tabular-mono so they never reflow when the value ticks.
  -->
  <div class="metrics">
    <div class="metric metric--torrents" :style="{ '--stagger': '0ms' }">
      <span class="metric-label">{{ $t('admin.stats.activeTorrents') }}</span>
      <span class="metric-value tabular-nums">{{ formatNumber(torrents) }}</span>
      <span class="metric-foot">
        <Icon name="ph:package-bold" class="metric-foot-icon" />
        {{ $t('admin.stats.torrentsFoot') }}
      </span>
    </div>

    <div class="metric metric--peers" :style="{ '--stagger': '60ms' }">
      <span class="metric-label">{{ $t('admin.stats.totalPeers') }}</span>
      <span class="metric-value tabular-nums">{{ formatNumber(peers) }}</span>
      <span class="metric-foot">
        <Icon name="ph:users-three-bold" class="metric-foot-icon" />
        {{ $t('admin.stats.peersFoot') }}
      </span>
    </div>

    <div class="metric metric--seeders" :style="{ '--stagger': '120ms' }">
      <span class="metric-label">{{ $t('admin.stats.seeders') }}</span>
      <span class="metric-value tabular-nums">{{ formatNumber(seeders) }}</span>
      <span class="metric-foot">
        <Icon name="ph:plant-bold" class="metric-foot-icon" />
        {{ $t('admin.stats.seedersFoot', { pct: seederRatio }) }}
      </span>
    </div>

    <div class="metric metric--leechers" :style="{ '--stagger': '180ms' }">
      <span class="metric-label">{{ $t('admin.stats.leechers') }}</span>
      <span class="metric-value tabular-nums">{{ formatNumber(leechers) }}</span>
      <span class="metric-foot">
        <Icon name="ph:arrow-down-bold" class="metric-foot-icon" />
        {{ $t('admin.stats.leechersFoot', { pct: leecherRatio }) }}
      </span>
    </div>
  </div>
</template>

<script setup lang="ts">
interface TrackerStats {
  cached?: {
    torrents?: number;
    peers?: number;
    seeders?: number;
    leechers?: number;
  };
  live?: {
    torrents?: number;
    peers?: number;
  };
}

const props = defineProps<{ stats?: TrackerStats }>();

const torrents = computed(() => props.stats?.live?.torrents ?? 0);
const peers = computed(() => props.stats?.cached?.peers ?? 0);
const seeders = computed(() => props.stats?.cached?.seeders ?? 0);
// Read leechers straight from the backend rather than deriving it from
// `peers - seeders`: a single machine can seed one torrent and leech
// another simultaneously, in which case it belongs in both tiles. The
// backend exposes both sets independently (`utils/peerStats.ts`).
const leechers = computed(() => props.stats?.cached?.leechers ?? 0);

const seederRatio = computed(() => {
  if (peers.value === 0) return '0';
  return Math.round((seeders.value / peers.value) * 100).toString();
});
const leecherRatio = computed(() => {
  if (peers.value === 0) return '0';
  return Math.round((leechers.value / peers.value) * 100).toString();
});

function formatNumber(n: number): string {
  // Compact representation only when the value crosses 10k so small
  // trackers keep the exact count; 18.4k reads better than 18432.
  if (n < 10_000) return n.toLocaleString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
</script>

<style scoped>
.metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.85rem;
}

.metric {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 1.05rem 1.1rem 0.95rem;
  background: rgb(var(--bg-elevated));
  border: 1px solid rgb(var(--line-default));
  border-radius: var(--radius-md);
  overflow: hidden;
  transition: border-color 0.2s ease, transform 0.2s ease,
    box-shadow 0.2s ease;
  animation: metric-in 0.42s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
  animation-delay: var(--stagger, 0ms);
}
.metric::before {
  /* Coloured rail along the top edge of the tile — instant visual
     anchor for what kind of number this is. */
  content: '';
  position: absolute;
  top: 0;
  inset-inline: 0;
  height: 2px;
  background: var(--rail, rgb(var(--line-strong)));
  box-shadow: 0 0 8px var(--rail-glow, transparent);
}
.metric:hover {
  transform: translateY(-1px);
  border-color: var(--rail, rgb(var(--line-strong)));
  box-shadow: 0 12px 28px -22px rgba(0, 0, 0, 0.7);
}
@keyframes metric-in {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.metric--torrents { --rail: #d4a734; --rail-glow: rgba(212, 167, 52, 0.4); }
.metric--peers    { --rail: rgb(var(--fg-strong)); }
.metric--seeders  { --rail: #6cd161; --rail-glow: rgba(108, 209, 97, 0.4); }
.metric--leechers { --rail: #fb923c; --rail-glow: rgba(251, 146, 60, 0.4); }

.metric-label {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 9.5px;
  font-weight: 800;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.metric-value {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 2.45rem;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1;
  color: rgb(var(--fg-strong));
}
.metric--torrents .metric-value { color: #d4a734; }
.metric--seeders .metric-value { color: #6cd161; }
.metric--leechers .metric-value { color: #fb923c; }

.metric-foot {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: auto;
  padding-top: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.metric-foot-icon { font-size: 0.85rem; }
</style>
