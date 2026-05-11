<template>
  <!--
    Step-function curve for bonus tier multipliers.

    The /admin/bonus-rules page shapes how much points users earn
    on top of the base seeding rate via two piecewise-constant
    curves: seed-count (rarer swarms pay more) and account age
    (older releases pay more). Both render here.

    Visual: an SVG step plot drawn in the accent colour passed by
    the parent (cyan for seed, orange for age). Threshold markers
    sit at each tier with vertical guide rules so the admin can
    eye-ball "this multiplier kicks in here". Disabled tiers are
    drawn as hollow circles so the chart still reflects the saved
    policy without lying about what's active.

    Y-axis is annotated at 0.5x / 1x / 2x / 4x where the range
    allows (we adapt to the actual max so a low-stakes economy
    doesn't show a mostly-empty 4x chart). X-axis labels at each
    threshold.
  -->
  <div class="tcurve">
    <div v-if="tiers.length === 0" class="tcurve-empty">
      <Icon name="ph:chart-line-bold" />
      <span>{{ emptyLabel }}</span>
    </div>

    <svg
      v-else
      class="tcurve-svg"
      viewBox="0 0 800 200"
      preserveAspectRatio="none"
      role="img"
      :aria-label="`Tier multiplier curve, ${tiers.length} thresholds`"
    >
      <!-- Grid lines at y ticks -->
      <g class="tcurve-grid">
        <line
          v-for="tick in yTicks"
          :key="`g${tick.value}`"
          :x1="PAD_L"
          :y1="tick.y"
          :x2="W - PAD_R"
          :y2="tick.y"
        />
      </g>

      <!-- Faint horizontal baseline at multiplier = 100 (×1.0) so
           admins immediately see "above this line = bonus, below
           = penalty". -->
      <line
        v-if="hasBaseline"
        class="tcurve-baseline"
        :x1="PAD_L"
        :y1="y(100)"
        :x2="W - PAD_R"
        :y2="y(100)"
      />

      <!-- Filled area under the curve (subtle accent tint) -->
      <polygon
        class="tcurve-area"
        :points="areaPoints"
        :fill="accent"
      />

      <!-- Step function line -->
      <polyline
        class="tcurve-line"
        :points="linePoints"
        fill="none"
        :stroke="accent"
        stroke-width="2"
        stroke-linejoin="miter"
        stroke-linecap="round"
      />

      <!-- Threshold markers — vertical guides + dots at the steps -->
      <g class="tcurve-markers">
        <g
          v-for="(t, i) in tiers"
          :key="`m${i}`"
          class="tcurve-marker"
          :style="{ '--m-stagger': `${i * 80}ms` }"
        >
          <line
            class="tcurve-marker-guide"
            :x1="x(t.threshold)"
            :y1="PAD_T"
            :x2="x(t.threshold)"
            :y2="H - PAD_B"
          />
          <circle
            class="tcurve-marker-dot"
            :cx="x(t.threshold)"
            :cy="y(t.multiplier)"
            r="5"
            :fill="t.enabled ? accent : 'rgb(var(--bg-elevated))'"
            :stroke="accent"
            stroke-width="2"
          />
        </g>
      </g>

      <!-- Y-axis labels -->
      <g class="tcurve-y-labels">
        <text
          v-for="tick in yTicks"
          :key="`yl${tick.value}`"
          :x="PAD_L - 6"
          :y="tick.y + 4"
          text-anchor="end"
        >
          ×{{ formatMul(tick.value / 100) }}
        </text>
      </g>

      <!-- X-axis baseline -->
      <line
        class="tcurve-x-axis"
        :x1="PAD_L"
        :y1="H - PAD_B"
        :x2="W - PAD_R"
        :y2="H - PAD_B"
      />

      <!-- X-axis labels at each threshold -->
      <g class="tcurve-x-labels">
        <text
          v-for="(t, i) in tiers"
          :key="`xl${i}`"
          :x="x(t.threshold)"
          :y="H - 10"
          text-anchor="middle"
        >
          {{ t.threshold }}
        </text>
      </g>
    </svg>

    <!-- Foot — axis legends + range readout -->
    <footer class="tcurve-foot">
      <span class="tcurve-axis">
        <Icon name="ph:arrow-right-bold" />
        {{ xLabel }}
        <span class="tcurve-axis-unit">{{ xUnit }}</span>
      </span>
      <span class="tcurve-readout tabular-nums">
        <Icon name="ph:wave-sine-bold" />
        ×{{ formatMul(minMul) }} → ×{{ formatMul(maxMul) }}
      </span>
    </footer>
  </div>
</template>

<script setup lang="ts">
interface CurveTier {
  threshold: number;
  multiplier: number;
  enabled: boolean;
}

const props = defineProps<{
  tiers: CurveTier[];
  xLabel: string;
  xUnit: string;
  accent: string;
  /**
   * Shape of the policy:
   *   - 'desc': multiplier decreases as threshold grows (seed scarcity)
   *   - 'asc':  multiplier increases as threshold grows (longevity)
   * Drives the step direction; both lay out the same way visually,
   * but we expose the prop so the parent's intent is documented at
   * the call site.
   */
  direction: 'asc' | 'desc';
  emptyLabel: string;
}>();

// ── SVG geometry ──────────────────────────────────────────────
// Working in viewBox units (800×200) with fixed padding. The SVG
// stretches horizontally; we use `preserveAspectRatio="none"` so
// thresholds line up with their labels regardless of container
// width.
const W = 800;
const H = 200;
const PAD_L = 44; // y-axis labels
const PAD_R = 16;
const PAD_T = 14;
const PAD_B = 26; // x-axis labels

// Data bounds — derive scale from the tiers themselves so a low-
// stakes economy doesn't show a mostly-empty 5x chart.
const xMax = computed(() => {
  if (props.tiers.length === 0) return 1;
  const m = Math.max(...props.tiers.map((t) => t.threshold));
  // Add 10% headroom so the last marker isn't flush against the
  // right edge.
  return Math.max(1, Math.ceil(m * 1.1));
});

const yMaxRaw = computed(() => {
  if (props.tiers.length === 0) return 200;
  const m = Math.max(...props.tiers.map((t) => t.multiplier));
  // Anchor to common ceilings (200, 400, 600, …) so the y-axis
  // ticks land on rounded multipliers.
  if (m <= 200) return 200;
  if (m <= 400) return 400;
  if (m <= 600) return 600;
  return Math.ceil(m / 200) * 200;
});

// Plot-area helpers — convert data values to SVG coordinates.
function x(value: number): number {
  const plotWidth = W - PAD_L - PAD_R;
  return PAD_L + (value / xMax.value) * plotWidth;
}
function y(mult: number): number {
  const plotHeight = H - PAD_T - PAD_B;
  return PAD_T + (1 - mult / yMaxRaw.value) * plotHeight;
}

// Y-axis ticks: try 0.5x / 1x / 2x / 4x where they fit, else
// adapt. Most policies fit "×0.5, ×1, ×2, ×4" and the chart reads
// like a music EQ — visually a step away from generic admin
// forms.
const yTicks = computed(() => {
  const candidates = [50, 100, 200, 400, 600, 800, 1000];
  return candidates
    .filter((v) => v <= yMaxRaw.value && v > 0)
    .map((v) => ({ value: v, y: y(v) }));
});

const hasBaseline = computed(() => yMaxRaw.value >= 100);

// Step function geometry. For each tier i, emit a horizontal
// segment up to threshold[i] at the *previous* multiplier, then
// a vertical jump to the current multiplier. The first tier
// starts at x = 0; the last extends to x = xMax for visual
// closure.
const linePoints = computed(() => {
  if (props.tiers.length === 0) return '';
  const t = props.tiers;
  const pts: Array<[number, number]> = [];
  pts.push([x(0), y(t[0]!.multiplier)]);
  for (let i = 0; i < t.length; i += 1) {
    const xi = x(t[i]!.threshold);
    const yi = y(t[i]!.multiplier);
    // Horizontal at the previous multiplier up to this threshold.
    if (i > 0) {
      const prevMul = y(t[i - 1]!.multiplier);
      pts.push([xi, prevMul]);
    }
    // Jump to the current multiplier.
    pts.push([xi, yi]);
  }
  // Carry the last multiplier out to the right edge.
  pts.push([x(xMax.value), y(t[t.length - 1]!.multiplier)]);
  return pts.map(([px, py]) => `${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
});

// Filled area below the curve down to the x-axis. Same points
// as the line plus two closing corners.
const areaPoints = computed(() => {
  if (props.tiers.length === 0) return '';
  const line = linePoints.value;
  const yBaseline = H - PAD_B;
  // Append "right-edge bottom" then "left-edge bottom" to close.
  return `${line} ${(W - PAD_R).toFixed(1)},${yBaseline} ${PAD_L},${yBaseline}`;
});

// ── Readouts for the foot ─────────────────────────────────────
const enabledMuls = computed(() =>
  props.tiers.filter((t) => t.enabled).map((t) => t.multiplier),
);
const minMul = computed(() =>
  enabledMuls.value.length > 0 ? Math.min(...enabledMuls.value) / 100 : 0,
);
const maxMul = computed(() =>
  enabledMuls.value.length > 0 ? Math.max(...enabledMuls.value) / 100 : 0,
);

function formatMul(v: number): string {
  return v.toFixed(2).replace(/\.?0+$/, '') || '0';
}
</script>

<style scoped>
.tcurve {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.tcurve-empty {
  height: 180px;
  display: grid;
  place-items: center;
  gap: 0.5rem;
  color: rgb(var(--fg-muted));
  font-size: 0.85rem;
  border: 1px dashed rgb(var(--line-default));
  border-radius: var(--radius-sm);
}
.tcurve-empty > svg {
  font-size: 1.8rem;
  opacity: 0.55;
}

.tcurve-svg {
  width: 100%;
  height: 200px;
  display: block;
  overflow: visible;
}

/* Hairline grid behind the curve. */
.tcurve-grid line {
  stroke: rgb(var(--line-default));
  stroke-width: 0.5;
  stroke-dasharray: 3 5;
  opacity: 0.55;
}

/* Baseline at ×1 — admins read above as bonus, below as penalty. */
.tcurve-baseline {
  stroke: rgb(var(--fg-faint));
  stroke-width: 0.8;
  stroke-dasharray: 4 4;
  opacity: 0.7;
}

.tcurve-x-axis {
  stroke: rgb(var(--line-strong));
  stroke-width: 1;
}

/* Threshold guide rules — subtle, only there to anchor markers. */
.tcurve-marker-guide {
  stroke: rgb(var(--line-default));
  stroke-width: 0.5;
  stroke-dasharray: 2 5;
  opacity: 0.6;
}

/* The actual step line draws in on mount. The polyline has a
   total length we can't easily compute statically, so we use a
   large stroke-dasharray then animate `stroke-dashoffset` to
   zero. The visual is "the curve carves itself in over 800 ms". */
.tcurve-line {
  stroke-dasharray: 1800;
  stroke-dashoffset: 1800;
  animation: tcurve-draw 0.85s cubic-bezier(0.2, 0.7, 0.2, 1) 80ms forwards;
  filter: drop-shadow(0 1px 8px color-mix(in srgb, currentColor 30%, transparent));
}
@keyframes tcurve-draw {
  to { stroke-dashoffset: 0; }
}

/* Filled area fades in slightly after the line — sequencing
   gives the curve more presence on first paint. */
.tcurve-area {
  opacity: 0;
  animation: tcurve-fill 0.6s ease 0.5s forwards;
  fill-opacity: 0.1;
}
@keyframes tcurve-fill {
  to { opacity: 1; }
}

/* Markers pop in one by one — each with its own --m-stagger. */
.tcurve-marker {
  opacity: 0;
  animation: tcurve-mark 0.4s ease forwards;
  animation-delay: calc(0.6s + var(--m-stagger, 0ms));
}
.tcurve-marker-dot {
  filter: drop-shadow(0 0 6px color-mix(in srgb, currentColor 50%, transparent));
}
@keyframes tcurve-mark {
  from { opacity: 0; transform: scale(0.6); }
  to { opacity: 1; transform: scale(1); }
}

/* Axis labels — mono, small, muted. */
.tcurve-y-labels text,
.tcurve-x-labels text {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  fill: rgb(var(--fg-muted));
  font-weight: 600;
  letter-spacing: 0.04em;
}

/* ── Foot — axis legend + range readout ────────────────────── */
.tcurve-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.85rem;
  padding: 0.4rem 0 0;
  border-top: 1px dashed rgb(var(--line-default) / 0.5);
  margin-top: 0.15rem;
}
.tcurve-axis {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgb(var(--fg-muted));
}
.tcurve-axis-unit {
  color: rgb(var(--fg-faint));
  font-weight: 500;
  letter-spacing: 0.12em;
}
.tcurve-readout {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: rgb(var(--fg-strong));
  text-transform: uppercase;
}
.tcurve-readout > svg {
  color: #d4a734;
}
</style>
