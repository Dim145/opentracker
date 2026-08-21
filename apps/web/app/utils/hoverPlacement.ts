/**
 * Where a floating panel goes when it is anchored to something small.
 *
 * Pulled out of the component because it is the part that breaks silently: a
 * poster preview that renders is obviously fine, and one that renders half off
 * the bottom of the screen is only noticed by whoever happens to hover the last
 * row. The rules are arithmetic, so they can be checked.
 *
 * Three of them:
 *
 *  1. Beside the anchor, on the side where there is room — right by default,
 *     left when the right would overflow. Never on top of the anchor: the row
 *     it belongs to has to stay readable.
 *  2. Vertically centred on the anchor, then clamped inside the viewport, so a
 *     group at the very top or the very bottom still gets a whole poster.
 *  3. Shrunk, keeping its aspect ratio, when even the full height does not fit.
 *     A short viewport gets a smaller poster rather than a cropped one.
 */
export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface PlacementOptions {
  /** Preferred width, before any shrink to fit. */
  cardWidth: number;
  /** height / width. A poster is 3 / 2. */
  ratio: number;
  /** Space kept between the anchor and the panel. */
  gap: number;
  /** Space kept from every viewport edge. */
  margin: number;
}

export interface Placement {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Which side of the anchor it landed on. Useful for a pointer or a shadow. */
  side: 'right' | 'left';
}

export function placeBeside(
  anchor: Rect,
  viewport: Viewport,
  opts: PlacementOptions,
): Placement {
  const { cardWidth, ratio, gap, margin } = opts;

  const height = Math.min(cardWidth * ratio, viewport.height - margin * 2);
  const width = height / ratio;

  const roomRight = viewport.width - anchor.right - gap - margin;
  const side: 'right' | 'left' = roomRight >= width ? 'right' : 'left';
  const left =
    side === 'right'
      ? anchor.right + gap
      : Math.max(margin, anchor.left - gap - width);

  const centred = anchor.top + anchor.height / 2 - height / 2;
  const top = Math.min(
    Math.max(margin, centred),
    viewport.height - height - margin,
  );

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
    side,
  };
}
