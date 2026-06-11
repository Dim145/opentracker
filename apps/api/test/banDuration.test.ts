import { describe, it, expect } from 'vitest';
import { computeBannedUntil, BAN_DURATIONS } from '../utils/banDuration';

const DAY = 24 * 60 * 60 * 1000;

describe('computeBannedUntil', () => {
  it('returns null for a permanent ban', () => {
    expect(computeBannedUntil('permanent')).toBeNull();
  });

  it('offsets day-based presets from now (DST-tolerant window)', () => {
    const HOUR = 60 * 60 * 1000;
    const before = Date.now();
    const oneDay = computeBannedUntil('1d')!;
    const sevenDay = computeBannedUntil('7d')!;

    expect(oneDay).toBeInstanceOf(Date);
    // setDate(+N) keeps wall-clock time, so across a DST boundary the
    // elapsed ms can drift ±1h. Assert a generous ±2h window around N*24h.
    const oneDelta = oneDay.getTime() - before;
    expect(oneDelta).toBeGreaterThan(DAY - 2 * HOUR);
    expect(oneDelta).toBeLessThan(DAY + 2 * HOUR);

    const sevenDelta = sevenDay.getTime() - before;
    expect(sevenDelta).toBeGreaterThan(7 * DAY - 2 * HOUR);
    expect(sevenDelta).toBeLessThan(7 * DAY + 2 * HOUR);
  });

  it('advances the calendar month for 1m', () => {
    const now = new Date();
    const r = computeBannedUntil('1m')!;
    // Month component advances by one (mod 12). Day-of-month may clamp
    // (e.g. Jan 31 -> Mar 3) but the result is always in the future.
    expect(r.getTime()).toBeGreaterThan(now.getTime());
    expect(r.getTime() - now.getTime()).toBeGreaterThan(27 * DAY);
    expect(r.getTime() - now.getTime()).toBeLessThan(32 * DAY);
  });

  it('advances the calendar year for 1y', () => {
    const now = new Date();
    const r = computeBannedUntil('1y')!;
    expect(r.getFullYear()).toBe(now.getFullYear() + 1);
  });

  it('exposes exactly the documented presets', () => {
    expect([...BAN_DURATIONS]).toEqual(['1d', '7d', '1m', '1y', 'permanent']);
  });
});
