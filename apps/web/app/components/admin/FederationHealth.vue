<template>
  <!--
    Tableau de bord de la fédération.

    Parti pris : la santé n'est pas un mot, c'est une grandeur qui se dégrade.
    Le bandeau du haut montre le temps écoulé depuis le dernier passage rapporté
    au seuil de retard — on lit une jauge qui se remplit, pas un horodatage
    qu'il faut soustraire de tête. En dessous, un rail coloré par pair rend le
    verdict lisible en vision périphérique, et le détail par ressource est un
    registre monospace aligné, parce que c'est ce qu'un opérateur balaie
    réellement : combien d'éléments, quand, où en est le curseur.
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
        <!-- ── Battement de cœur ─────────────────────────────────────────
             Le seul chiffre qu'on regarde en premier : à quand remonte le
             dernier passage, et est-ce inquiétant ? -->
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
            <span class="fh-peer-mirror tabular-nums">
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

          <!-- L'erreur se lit, elle ne se survole pas : un opérateur qui
               diagnostique a besoin du message, pas d'une infobulle. -->
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
    lastRunAt: string | null;
  };
  peers: Peer[];
}

const { t, locale } = useI18n();
const { data, pending, refresh } = await useFetch<Health>(
  '/api/admin/federation/health',
);

/* L'horloge avance toute seule : sans ça, la jauge fige à l'instant du
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

/** Remplissage de la jauge : 100 % au seuil de retard. */
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

/** Première erreur rencontrée, pair ou ressource — c'est celle qui bloque. */
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
/** Un curseur est long et opaque : on n'en montre que les bouts. */
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
/* Repère du seuil : la jauge a une fin, il faut la voir. */
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
/* Un compteur à zéro est une bonne nouvelle : il ne doit pas crier. */
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
.fh-peer-mirror {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 0.75rem;
  color: rgb(var(--fg-muted));
}

/* Registre : colonnes fixes pour que l'œil descende en ligne droite. */
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
