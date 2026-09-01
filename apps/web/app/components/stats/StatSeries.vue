<template>
  <figure class="series">
    <figcaption class="series-cap">
      <span class="series-label">{{ label }}</span>
      <span v-if="points.length" class="series-latest">{{ format(points[points.length - 1]!) }}</span>
    </figcaption>

    <!-- Not enough history to draw a shape. Said plainly rather than drawn as a
         flat line at zero, which reads as "nothing happened" instead of "we
         have not been counting long enough". -->
    <p v-if="points.length < 2" class="series-empty">
      {{ $t('stats.series.tooShort') }}
    </p>

    <svg
      v-else
      class="series-svg"
      :class="`series-svg--${kind}`"
      :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
      preserveAspectRatio="none"
      role="img"
      :aria-label="summary"
    >
      <!-- Three gridlines, low contrast on purpose: they locate a value without
           competing with it. -->
      <line
        v-for="ratio in [0.25, 0.5, 0.75]"
        :key="ratio"
        class="series-grid"
        x1="0"
        :y1="VIEW_H * ratio"
        :x2="VIEW_W"
        :y2="VIEW_H * ratio"
      />
      <template v-if="kind === 'area'">
        <path class="series-fill" :d="areaPath" />
        <path class="series-line" :d="linePath" />
      </template>
      <template v-else>
        <rect
          v-for="(bar, i) in bars"
          :key="i"
          class="series-bar"
          :x="bar.x"
          :y="bar.y"
          :width="bar.w"
          :height="bar.h"
        />
      </template>
    </svg>

    <div v-if="points.length >= 2" class="series-axis">
      <span>{{ labels[0] }}</span>
      <span>{{ labels[labels.length - 1] }}</span>
    </div>

    <!-- The chart is a picture; this is the data. Collapsed so it costs a
         reader nothing, present so a screen reader and a sceptic both have
         somewhere to go. -->
    <details v-if="points.length" class="series-data">
      <summary>{{ $t('stats.series.table') }}</summary>
      <div class="series-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">{{ $t('stats.series.when') }}</th>
              <th scope="col">{{ label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(value, i) in points" :key="i">
              <td>{{ labels[i] }}</td>
              <td class="series-num">{{ format(value) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </details>
  </figure>
</template>

<script setup lang="ts">
/**
 * One series, drawn without a charting library.
 *
 * No library because of the CSP — `script-src 'self'` rules out a CDN, and the
 * shape needed here is a polyline and some rectangles. What a library would add
 * is 40 KB and a tooltip; what it would cost is a dependency in the page every
 * member loads.
 *
 * Three things here are deliberate rather than incidental:
 *
 * 1. **A short series says so.** Fewer than two points cannot make a line, and
 *    a chart padded to a window it has no data for draws a flat run at zero —
 *    which reads as "the site was dead until Tuesday".
 * 2. **The numbers are reachable.** A picture is not accessible and is not
 *    verifiable; the collapsed table under each chart is both, and it is the
 *    same array the shape is drawn from.
 * 3. **The scale starts at the minimum, not at zero.** These are cumulative
 *    counters — members, torrents — where the interesting part is the slope
 *    and a zero-based axis flattens it into a straight line. The axis labels
 *    say which window is shown, and the table gives the values, so nothing is
 *    hidden by the choice.
 */
const props = withDefaults(
  defineProps<{
    label: string;
    points: number[];
    /** One per point: `YYYY-MM-DD`, or a month name. */
    labels: string[];
    kind?: 'area' | 'bars';
    /** How to render a value — bytes, counts, whatever the caller means. */
    format?: (value: number) => string;
    /** For the accessible summary, e.g. "torrents". */
    unit?: string;
  }>(),
  {
    kind: 'area',
    format: (value: number) => value.toLocaleString(),
    unit: '',
  }
);

const { t } = useI18n();

const VIEW_W = 100;
const VIEW_H = 40;

const bounds = computed(() => {
  const min = Math.min(...props.points);
  const max = Math.max(...props.points);
  // A flat series would divide by zero; give it a band so the line sits in the
  // middle rather than at an edge.
  return max === min ? { min: min - 1, max: max + 1 } : { min, max };
});

function y(value: number): number {
  const { min, max } = bounds.value;
  const t = (value - min) / (max - min);
  // 1 unit of padding top and bottom so a peak is not clipped by the viewBox.
  return VIEW_H - 1 - t * (VIEW_H - 2);
}

function x(index: number): number {
  return props.points.length === 1
    ? VIEW_W / 2
    : (index / (props.points.length - 1)) * VIEW_W;
}

const linePath = computed(() =>
  props.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ')
);

const areaPath = computed(
  () => `${linePath.value} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`
);

/**
 * Bars are anchored at ZERO, not at the series minimum.
 *
 * `y()` interpolates between the minimum and the maximum, which is right for a
 * cumulative counter — the slope is the story — and wrong for a per-period
 * delta: a 90-day traffic series running between 900 GiB and 1 TiB drew the
 * quietest day as a hairline and the busiest as a full bar, rendering an 11 %
 * spread as a factor of a hundred. Worse, it made the quietest period look
 * identical to a period with nothing at all.
 */
const barMax = computed(() => Math.max(1, ...props.points));

const bars = computed(() => {
  const n = props.points.length;
  const slot = VIEW_W / n;
  const gap = Math.min(0.6, slot * 0.25);
  const zero = VIEW_H - 1;
  return props.points.map((value, i) => {
    const usable = VIEW_H - 2;
    const top = zero - (Math.max(0, value) / barMax.value) * usable;
    return {
      x: i * slot + gap / 2,
      w: Math.max(0.4, slot - gap),
      y: top,
      // A day with nothing still gets a hairline, so a gap in the data and a
      // day with no traffic do not look identical.
      h: Math.max(0.35, zero - top),
    };
  });
});

const summary = computed(() => {
  if (!props.points.length) return props.label;
  const unit = props.unit ? ` ${props.unit}` : '';
  if (props.kind === 'bars') {
    // Per-period bars have no meaningful first-to-last story — a year that
    // starts and ends in a quiet month would read "0 → 0". The peak is the
    // sentence somebody listening to this page actually wants.
    let peak = 0;
    let at = 0;
    props.points.forEach((value, i) => {
      if (value > peak) {
        peak = value;
        at = i;
      }
    });
    const total = props.points.reduce((sum, v) => sum + v, 0);
    // Translated like every other string here: an aria-label is read aloud, so
    // an English sentence in a French page is worse than a bare number.
    return t('stats.series.summaryBars', {
      label: props.label,
      total: `${props.format(total)}${unit}`,
      peak: props.format(peak),
      when: props.labels[at] ?? '',
    });
  }
  const first = props.points[0]!;
  const last = props.points[props.points.length - 1]!;
  return t('stats.series.summaryTrend', {
    label: props.label,
    from: props.format(first),
    to: `${props.format(last)}${unit}`,
  });
});

const format = (value: number) => props.format(value);
</script>

<style scoped>
.series {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  min-width: 0;
}
.series-cap {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}
.series-label {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: calc(0.14em * var(--tracking-scale));
  color: rgb(var(--fg-muted));
}
.series-latest {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.8125rem;
  color: rgb(var(--fg-default));
}
.series-svg {
  width: 100%;
  height: 5.5rem;
  overflow: visible;
}
.series-grid {
  stroke: rgb(var(--line-default));
  stroke-width: 0.25;
  vector-effect: non-scaling-stroke;
}
.series-fill {
  fill: rgb(var(--accent-warm) / 0.14);
}
.series-line {
  fill: none;
  stroke: rgb(var(--accent-warm));
  stroke-width: 1.5;
  stroke-linejoin: round;
  stroke-linecap: round;
  vector-effect: non-scaling-stroke;
}
.series-bar {
  fill: rgb(var(--chart-2));
}
.series-axis {
  display: flex;
  justify-content: space-between;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-faint));
}
.series-empty {
  padding: 1.5rem 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
  text-align: center;
}
.series-data {
  font-size: 0.6875rem;
  color: rgb(var(--fg-subtle));
}
.series-data summary {
  cursor: pointer;
  padding: 0.15rem 0;
}
.series-scroll {
  max-height: 12rem;
  overflow: auto;
  margin-top: 0.35rem;
}
.series-data table {
  width: 100%;
  border-collapse: collapse;
}
.series-data th,
.series-data td {
  text-align: left;
  padding: 0.15rem 0.4rem;
  border-bottom: 1px solid rgb(var(--line-default));
  white-space: nowrap;
}
.series-num {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  text-align: right;
}
</style>
