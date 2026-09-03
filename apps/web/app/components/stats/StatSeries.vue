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

    <div v-else class="series-plot">
      <!-- The top of the scale, stated. A min-anchored line chart with no
           number on it is the oldest way to overstate growth, and this page
           puts one next to a zero-anchored bar chart — so the reader compares
           two slopes drawn on different rulers. -->
      <span class="series-scale">{{ format(bounds.max) }}</span>
      <svg
        class="series-svg"
        :class="`series-svg--${kind}`"
        :viewBox="`0 0 ${VIEW_W} ${VIEW_H}`"
        preserveAspectRatio="none"
        role="img"
        :aria-label="summary"
      >
        <!-- Three gridlines, low contrast on purpose: they locate a value
             without competing with it. Placed against the plot band rather
             than the viewBox, so they land where the labels say they do. -->
        <line
          v-for="ratio in [0.25, 0.5, 0.75]"
          :key="ratio"
          class="series-grid"
          x1="0"
          :y1="1 + (VIEW_H - 2) * ratio"
          :x2="VIEW_W"
          :y2="1 + (VIEW_H - 2) * ratio"
        />
        <template v-if="kind === 'area'">
          <path class="series-fill" :d="areaPath" />
          <path class="series-line" :d="linePath" />
          <!-- The latest point, marked. Most of a tooltip's value for one
               circle, and it works on touch, where a tooltip does not. -->
          <circle
            class="series-dot"
            :cx="x(shown.length - 1)"
            :cy="y(shown[shown.length - 1]!)"
            r="1.1"
          />
        </template>
        <template v-else>
          <rect
            v-for="(bar, i) in bars"
            :key="i"
            class="series-bar"
            :class="{ 'series-bar--peak': i === peak.at }"
            :x="bar.x"
            :y="bar.y"
            :width="bar.w"
            :height="bar.h"
          />
          <!-- A real baseline, drawn once at a stroke width that survives the
               viewBox scaling. The previous approach gave every bar a 0.35-unit
               minimum height — 0.77px at this size, so it rendered as a smudge
               or vanished on rounding, and could not separate "no traffic" from
               "almost none" anyway. Against a visible axis, an empty day is
               visibly empty. -->
          <line
            class="series-baseline"
            x1="0"
            :y1="VIEW_H - 1"
            :x2="VIEW_W"
            :y2="VIEW_H - 1"
          />
        </template>
      </svg>
      <span class="series-scale series-scale--min">{{ format(kind === 'bars' ? 0 : bounds.min) }}</span>
    </div>

    <div v-if="points.length >= 2" class="series-axis">
      <span>{{ shownLabels[0] }}</span>
      <span v-if="bucketed" class="series-bucket">{{ $t('stats.series.weekly') }}</span>
      <span>{{ shownLabels[shownLabels.length - 1] }}</span>
    </div>

    <!-- The chart is a picture; this is the data. Collapsed so it costs a
         reader nothing, present so a screen reader and a sceptic both have
         somewhere to go. -->
    <details v-if="points.length" class="series-data">
      <!-- Named, because a growth panel renders three of these and a reader
           listing the page's controls would otherwise hear the same sentence
           three times with nothing to tell them apart. -->
      <summary>{{ $t('stats.series.tableFor', { label }) }}</summary>
      <!-- Focusable, because a scroll container that only the mouse can reach
           hides the 365 rows it just revealed from the keyboard. -->
      <div class="series-scroll" tabindex="0" role="group" :aria-label="label">
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
 * Four things here are deliberate rather than incidental:
 *
 * 1. **A short series says so.** Fewer than two points cannot make a line, and
 *    a chart padded to a window it has no data for draws a flat run at zero —
 *    which reads as "the site was dead until Tuesday".
 * 2. **The numbers are reachable.** A picture is not accessible and is not
 *    verifiable; the collapsed table under each chart is both, and it is the
 *    same array the shape is drawn from — the full array, not the buckets.
 * 3. **The scale starts at the minimum for a cumulative series, and its ends
 *    are labelled.** These are counters — members, torrents — where the
 *    interesting part is the slope and a zero-based axis flattens it into a
 *    straight line. The labels are what makes that choice honest rather than
 *    flattering: a reader can see the run starts at 5,412, not at nothing.
 * 4. **Too many points get bucketed, not squeezed.** See `shown` below.
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

/*
 * The geometry and the bucketing live in `~/utils/statSeries`, tested there.
 * Both were wrong once — bars wider than their slots turned the 365-day window
 * into a solid rectangle — and both are pure arithmetic, so they belong
 * somewhere a test can reach without a DOM.
 */
const bucketed = computed(
  () => props.kind === 'bars' && shouldBucket(props.points.length)
);

/** The points actually drawn: either all of them, or one sum per week. */
const shown = computed(() =>
  bucketed.value ? bucketSums(props.points) : props.points
);

const shownLabels = computed(() =>
  bucketed.value ? bucketLabels(props.labels) : props.labels
);

const bounds = computed(() => {
  const min = Math.min(...shown.value);
  const max = Math.max(...shown.value);
  // A flat series would divide by zero; give it a band so the line sits in the
  // middle rather than at an edge.
  return max === min ? { min: min - 1, max: max + 1 } : { min, max };
});

function y(value: number): number {
  const { min, max } = bounds.value;
  const ratio = (value - min) / (max - min);
  // 1 unit of padding top and bottom so a peak is not clipped by the viewBox.
  return VIEW_H - 1 - ratio * (VIEW_H - 2);
}

function x(index: number): number {
  return shown.value.length === 1
    ? VIEW_W / 2
    : (index / (shown.value.length - 1)) * VIEW_W;
}

const linePath = computed(() =>
  shown.value
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
    .join(' ')
);

const areaPath = computed(
  () => `${linePath.value} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`
);

const bars = computed(() => barGeometry(shown.value));

/** The tallest bar, for the marker and for the spoken summary. */
const peak = computed(() => {
  let value = 0;
  let at = -1;
  shown.value.forEach((v, i) => {
    if (v > value) {
      value = v;
      at = i;
    }
  });
  return { value, at };
});

const summary = computed(() => {
  if (!props.points.length) return props.label;
  const unit = props.unit ? ` ${props.unit}` : '';
  if (props.kind === 'bars') {
    // Per-period bars have no meaningful first-to-last story — a year that
    // starts and ends in a quiet month would read "0 → 0". The peak is the
    // sentence somebody listening to this page actually wants.
    const total = props.points.reduce((sum, v) => sum + v, 0);
    // Translated like every other string here: an aria-label is read aloud, so
    // an English sentence in a French page is worse than a bare number.
    return t('stats.series.summaryBars', {
      label: props.label,
      total: `${props.format(total)}${unit}`,
      peak: props.format(peak.value.value),
      when: shownLabels.value[Math.max(0, peak.value.at)] ?? '',
    });
  }
  const first = props.points[0]!;
  const last = props.points[props.points.length - 1]!;
  // With the window: "5,412 to 12,431" over an unstated period is a number
  // pair, not a trend, and the axis labels that carry the period live outside
  // the `role="img"` this sentence names.
  return t('stats.series.summaryTrend', {
    label: props.label,
    from: props.format(first),
    to: `${props.format(last)}${unit}`,
    first: props.labels[0] ?? '',
    last: props.labels[props.labels.length - 1] ?? '',
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
/* The plot and its two scale labels. Relative so the labels can sit on the
   chart's own corners without a grid track of their own — at 10px they would
   otherwise reserve a column the chart needs more than they do. */
.series-plot {
  position: relative;
}
.series-scale {
  position: absolute;
  top: 0;
  left: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 0.5625rem;
  color: rgb(var(--fg-subtle));
  background: rgb(var(--bg-surface) / 0.85);
  padding: 0 0.2rem;
  pointer-events: none;
}
.series-scale--min {
  top: auto;
  bottom: 0;
}
.series-svg {
  display: block;
  width: 100%;
  height: 5.5rem;
  overflow: visible;
}
.series-grid {
  stroke: rgb(var(--line-default));
  stroke-width: 0.25;
  vector-effect: non-scaling-stroke;
}
.series-baseline {
  stroke: rgb(var(--line-strong));
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}
/* One quantity colour for every series on this page.
   `--chart-1..6` is a categorical scale — its whole job is telling six series
   in one chart apart — and no chart here has more than one series. Using green
   for traffic and blue for categories on a gold-accented page encoded nothing
   and read as three unrelated products. */
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
.series-dot {
  fill: rgb(var(--accent-warm));
  stroke: rgb(var(--bg-surface));
  stroke-width: 0.5;
}
.series-bar {
  fill: rgb(var(--accent-warm) / 0.55);
}
.series-bar--peak {
  fill: rgb(var(--accent-warm));
}
.series-axis {
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  font-family: var(--font-mono);
  font-size: 0.625rem;
  color: rgb(var(--fg-subtle));
}
.series-bucket {
  text-transform: uppercase;
  letter-spacing: calc(0.08em * var(--tracking-scale));
}
.series-empty {
  padding: 1.5rem 0;
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
  text-align: center;
}
.series-data {
  font-size: 0.75rem;
  color: rgb(var(--fg-subtle));
}
/* ≥24px, per WCAG 2.2 SC 2.5.8 — it was ~20px — and a hover, because at 11px
   in the faintest grey on the page it read as a footnote rather than a
   control. */
.series-data summary {
  cursor: pointer;
  padding: 0.4rem 0;
  width: fit-content;
}
.series-data summary:hover {
  color: rgb(var(--fg-default));
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
