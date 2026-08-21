import { describe, it, expect } from 'vitest';
import { placeBeside, type Rect } from '../app/utils/hoverPlacement';

// Where the poster preview lands.
//
// This is the part of a hover panel that fails quietly. A panel that renders
// is obviously working; one that renders half off the bottom of the screen is
// only ever met by whoever happens to hover the last row of a page, which is
// nobody until it is somebody.

const OPTS = { cardWidth: 260, ratio: 3 / 2, gap: 14, margin: 12 };
const VIEWPORT = { width: 1280, height: 900 };

/** A 40×60 thumbnail at the left edge of a row. */
function thumb(top: number, left = 20): Rect {
  return {
    top,
    left,
    right: left + 40,
    bottom: top + 60,
    width: 40,
    height: 60,
  };
}

describe('placeBeside', () => {
  it('sits to the right of the anchor, centred on it', () => {
    const p = placeBeside(thumb(400), VIEWPORT, OPTS);
    expect(p.side).toBe('right');
    expect(p.left).toBe(20 + 40 + 14);
    // 60px anchor, 390px panel → the panel overhangs equally either side.
    expect(p.top).toBe(400 + 30 - 195);
    expect(p.width).toBe(260);
    expect(p.height).toBe(390);
  });

  it('flips to the left when the right would overflow', () => {
    const nearRight = thumb(400, VIEWPORT.width - 60);
    const p = placeBeside(nearRight, VIEWPORT, OPTS);
    expect(p.side).toBe('left');
    expect(p.left).toBe(nearRight.left - 14 - 260);
    expect(p.left).toBeGreaterThanOrEqual(OPTS.margin);
  });

  it('never leaves the viewport, whichever edge the anchor hugs', () => {
    for (const top of [0, 5, 400, 860, 899]) {
      const p = placeBeside(thumb(top), VIEWPORT, OPTS);
      expect(p.top, `top for anchor at ${top}`).toBeGreaterThanOrEqual(
        OPTS.margin,
      );
      expect(p.top + p.height, `bottom for anchor at ${top}`).toBeLessThanOrEqual(
        VIEWPORT.height - OPTS.margin,
      );
    }
  });

  it('shrinks rather than crops when the viewport is short', () => {
    // A laptop with a small window still gets a whole poster.
    const short = { width: 1280, height: 300 };
    const p = placeBeside(thumb(120), short, OPTS);
    expect(p.height).toBe(300 - OPTS.margin * 2);
    // The aspect ratio is what makes it a poster rather than a letterbox.
    expect(p.width).toBe(Math.round(p.height / OPTS.ratio));
    expect(p.top).toBeGreaterThanOrEqual(OPTS.margin);
    expect(p.top + p.height).toBeLessThanOrEqual(short.height - OPTS.margin);
  });

  it('clamps to the margin when neither side has room', () => {
    // A viewport barely wider than the panel: it cannot avoid the anchor, but
    // it must still be on screen.
    const narrow = { width: 320, height: 900 };
    const p = placeBeside(thumb(400, 10), narrow, OPTS);
    expect(p.left).toBeGreaterThanOrEqual(OPTS.margin);
  });

  it('returns integers, so the panel lands on whole pixels', () => {
    const p = placeBeside(thumb(401.7, 20.3), VIEWPORT, OPTS);
    for (const v of [p.left, p.top, p.width, p.height]) {
      expect(Number.isInteger(v)).toBe(true);
    }
  });
});
