<script setup lang="ts">
/**
 * « Est-ce que ça va descendre ? » — la réponse avant le clic.
 *
 * Trois faits, dans l'ordre où on les cherche : l'état de l'essaim en un mot
 * (sain, fragile, sans source), la dernière annonce reçue, et la tendance sur
 * sept jours en courbe. Les deux premiers sortent de la charge de la fiche —
 * `stats` et les pairs anonymisés portent déjà tout ce qu'il faut. La courbe
 * vient de `torrent_stats_history`, chargée côté client seulement : elle est
 * décorative au premier écran et ne vaut pas une requête de plus au rendu
 * serveur.
 *
 * Les seuils : cinq sources et plus, l'essaim tient ; de une à quatre, il
 * dépend de quelques membres ; zéro, il n'y a rien à télécharger. Ce sont des
 * seuils de lecture, pas des règles du tracker — ils ne déclenchent rien.
 */
const props = withDefaults(
  defineProps<{
    hash: string;
    stats?: { seeders: number; leechers: number } | null;
    /** Les pairs tels que la fiche les reçoit : anonymisés, avec `lastSeen`. */
    peers?: ReadonlyArray<{ lastSeen?: string | null }> | null;
  }>(),
  { stats: null, peers: null },
);

const { t, locale } = useI18n();

const seeders = computed(() => props.stats?.seeders ?? 0);
const state = computed<'healthy' | 'fragile' | 'dead'>(() =>
  seeders.value >= 5 ? 'healthy' : seeders.value >= 1 ? 'fragile' : 'dead',
);

/** La dernière annonce reçue, tous pairs confondus. */
const lastAnnounce = computed(() => {
  let best = 0;
  for (const p of props.peers ?? []) {
    const ts = p.lastSeen ? new Date(p.lastSeen).getTime() : NaN;
    if (Number.isFinite(ts) && ts > best) best = ts;
  }
  return best > 0 ? formatAgo(new Date(best).toISOString(), locale.value) : null;
});

/* ── La tendance ─────────────────────────────────────────────────────────── */
interface Point { day: string; seeders: number; leechers: number }
const { data: history } = useFetch<{ days: number; points: Point[] }>(
  `/api/torrents/${props.hash}/stats-history`,
  { lazy: true, server: false, default: () => ({ days: 7, points: [] }) },
);

/**
 * Les points tracés : l'historique, puis la valeur du MOMENT comme dernier
 * point. Le jour courant est déjà dans l'historique si le collecteur est passé
 * aujourd'hui — la valeur vivante le remplace, elle est plus fraîche.
 */
const points = computed(() => {
  const today = new Date().toISOString().slice(0, 10);
  const hist = (history.value?.points ?? []).filter((p) => p.day !== today);
  return [...hist.map((p) => p.seeders), seeders.value];
});
const hasCurve = computed(() => points.value.length >= 2);

const W = 120, H = 38, PAD = 3;
const curve = computed(() => {
  const v = points.value;
  const n = v.length;
  if (n < 2) return null;
  const max = Math.max(1, ...v);
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (n - 1);
  const y = (val: number) => H - PAD - (val / max) * (H - 2 * PAD - 4);
  const line = v.map((val, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)} ${y(val).toFixed(1)}`).join(' ');
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - PAD} L${x(0).toFixed(1)} ${H - PAD} Z`;
  return { line, area, endX: x(n - 1), endY: y(v[n - 1]!) };
});
const curveLabel = computed(() =>
  t('torrents.detail.health.sparkAria', { n: points.value.length, values: points.value.join(', ') }),
);
</script>

<template>
  <div class="sh" :data-state="state">
    <div class="sh-text">
      <p class="sh-state">
        <span class="sh-pip" aria-hidden="true" />
        {{ $t(`torrents.detail.health.${state}`) }}
      </p>
      <p class="sh-why">
        <!-- « Aucune source » puis « 0 sources » disait deux fois la même
             chose. Sous zéro, ce qui informe c'est la dernière annonce — ou
             qu'il n'y en a jamais eu. -->
        <template v-if="state === 'dead'">
          {{ lastAnnounce
            ? $t('torrents.detail.health.lastAnnounceAlone', { when: lastAnnounce })
            : $t('torrents.detail.health.nobody') }}
        </template>
        <template v-else>
          {{ $t('torrents.detail.health.sources', { n: seeders.toLocaleString(locale) }, seeders) }}
          <template v-if="lastAnnounce">
            <span class="sh-dot" aria-hidden="true">·</span>
            {{ $t('torrents.detail.health.lastAnnounce', { when: lastAnnounce }) }}
          </template>
        </template>
      </p>
    </div>

    <!-- La courbe : sept jours de sources, le dernier point est maintenant.
         Décorative pour l'œil, mais son `aria-label` donne les valeurs. -->
    <svg
      v-if="curve"
      class="sh-spark"
      :viewBox="`0 0 ${W} ${H}`"
      role="img"
      :aria-label="curveLabel"
    >
      <line class="sh-spark-base" :x1="PAD" :y1="H - PAD" :x2="W - PAD" :y2="H - PAD" />
      <path class="sh-spark-area" :d="curve.area" />
      <path class="sh-spark-line" :d="curve.line" />
      <circle class="sh-spark-end" :cx="curve.endX" :cy="curve.endY" r="2.5" />
    </svg>
    <p v-else class="sh-soon">{{ $t('torrents.detail.health.historySoon') }}</p>
  </div>
</template>

<style scoped>
.sh {
  --tone: var(--online);
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 0.25rem 0.75rem;
  align-items: center;
}
.sh[data-state='fragile'] { --tone: var(--warning); }
.sh[data-state='dead'] { --tone: var(--danger); }
.sh-text { min-width: 0; }
.sh-state {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  margin: 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgb(var(--fg-strong));
}
/* La couleur double le mot, jamais seule : « fragile » est écrit. */
.sh-pip {
  width: 0.6rem;
  height: 0.6rem;
  border-radius: 50%;
  background: rgb(var(--tone));
  box-shadow: 0 0 0 4px rgb(var(--tone) / 0.18);
}
.sh-why {
  margin: 0.15rem 0 0;
  font-size: 0.6875rem;
  line-height: 1.45;
  color: rgb(var(--fg-muted));
  font-variant-numeric: tabular-nums;
}
.sh-dot { margin: 0 0.25rem; color: rgb(var(--fg-subtle)); }
.sh-spark {
  width: 7.5rem;
  height: 2.4rem;
  overflow: visible;
}
.sh-spark-base { stroke: rgb(var(--line-default)); stroke-width: 1; }
.sh-spark-area { fill: rgb(var(--tone) / 0.18); }
.sh-spark-line { fill: none; stroke: rgb(var(--tone)); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }
.sh-spark-end { fill: rgb(var(--tone)); }
.sh-soon {
  margin: 0;
  max-width: 7.5rem;
  font-size: 0.625rem;
  line-height: 1.35;
  text-align: right;
  color: rgb(var(--fg-subtle));
}
</style>
