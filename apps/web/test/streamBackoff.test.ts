import { describe, expect, it } from 'vitest';
import { BACKOFF_WINDOWS, backoffDelay } from '../app/utils/streamBackoff';

// The reconnection delay for the messaging stream.
//
// This looks like a triviality and is not: it is the difference between a
// relay node dying and a relay node taking the next one with it. Twenty
// thousand clients reconnecting on a fixed timer arrive together, each
// asking the API for a token and a catch-up.

describe('backoffDelay', () => {
  it('stays inside its window', () => {
    for (let attempt = 0; attempt < BACKOFF_WINDOWS.length; attempt++) {
      const [lo, hi] = BACKOFF_WINDOWS[attempt]!;
      for (const r of [0, 0.5, 0.999999]) {
        const delay = backoffDelay(attempt, () => r);
        expect(delay).toBeGreaterThanOrEqual(lo);
        expect(delay).toBeLessThan(hi);
      }
    }
  });

  it('widens with each attempt', () => {
    const mid = () => 0.5;
    const delays = BACKOFF_WINDOWS.map((_, i) => backoffDelay(i, mid));
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]!).toBeGreaterThan(delays[i - 1]!);
    }
  });

  it('holds the last window rather than growing without bound', () => {
    const mid = () => 0.5;
    const last = backoffDelay(BACKOFF_WINDOWS.length - 1, mid);
    expect(backoffDelay(99, mid)).toBe(last);
    // A negative attempt is a caller bug, not a reason to wait zero.
    expect(backoffDelay(-3, mid)).toBe(backoffDelay(0, mid));
  });

  it('actually spreads — this is the whole point', () => {
    // A constant delay passes every test above except this one. Two
    // hundred clients reconnecting must not land on one instant.
    const spread = new Set(
      Array.from({ length: 200 }, (_, i) => backoffDelay(0, () => i / 200))
    );
    expect(spread.size).toBeGreaterThan(100);
  });
});
