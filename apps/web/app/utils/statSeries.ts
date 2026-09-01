/**
 * The arithmetic behind `components/stats/StatSeries.vue`.
 *
 * Extracted from the component because the two things worth being sure of here
 * are numeric and were both wrong at some point:
 *
 * 1. **Bars must not overlap their slots.** The first version floored a bar's
 *    width at 0.4 viewBox units. At the 365-day window a slot is 0.274 units
 *    wide, so every bar was 46 % wider than the space it had and painted over
 *    its neighbour: the chart rendered as one solid rectangle, and a reader saw
 *    a year of uniform traffic where the data said otherwise.
 * 2. **Too many points get summed into weeks, not squeezed.** 365 bars in a
 *    100-unit viewBox cannot be read even without the overlap, and shrinking
 *    them to a sub-pixel hairline trades a lie for a smudge.
 *
 * A component test would need a DOM and a mount; these are numbers, so they get
 * a function and a table of assertions instead.
 */

/** Above this many points, a bar series is bucketed. */
export const BUCKET_ABOVE = 120;
/** Days per bucket. Weeks, because traffic has a weekly rhythm. */
export const BUCKET_SIZE = 7;

export const VIEW_W = 100;
export const VIEW_H = 40;

export function shouldBucket(count: number): boolean {
  return count > BUCKET_ABOVE;
}

/** Sum every `BUCKET_SIZE` values into one. The tail bucket may be short. */
export function bucketSums(points: number[], size = BUCKET_SIZE): number[] {
  const out: number[] = [];
  for (let i = 0; i < points.length; i += size) {
    out.push(points.slice(i, i + size).reduce((sum, v) => sum + v, 0));
  }
  return out;
}

/** One label per bucket: the first day in it. */
export function bucketLabels(labels: string[], size = BUCKET_SIZE): string[] {
  const out: string[] = [];
  for (let i = 0; i < labels.length; i += size) out.push(labels[i] ?? '');
  return out;
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Bars anchored at ZERO, one per point, none wider than its slot.
 *
 * Zero and not the series minimum: `y()` in the component interpolates between
 * min and max, which is right for a cumulative counter — the slope is the
 * story — and wrong for a per-period delta. A 90-day traffic series running
 * between 900 GiB and 1 TiB drew the quietest day as a hairline and the busiest
 * as a full bar, rendering an 11 % spread as a factor of a hundred, and making
 * the quietest period indistinguishable from a period with nothing at all.
 */
export function barGeometry(points: number[]): Bar[] {
  const n = points.length;
  if (n === 0) return [];
  const max = Math.max(1, ...points);
  const slot = VIEW_W / n;
  const gap = Math.min(0.6, slot * 0.25);
  const zero = VIEW_H - 1;
  const usable = VIEW_H - 2;
  return points.map((value, i) => {
    const top = zero - (Math.max(0, value) / max) * usable;
    return {
      x: i * slot + gap / 2,
      // No minimum width. A bar wider than its slot overlaps its neighbour,
      // which is how a year of traffic became a filled rectangle; sub-pixel is
      // at least honest, and past `BUCKET_ABOVE` we bucket rather than shrink.
      w: Math.max(0.05, slot - gap),
      y: top,
      h: Math.max(0, zero - top),
    };
  });
}
