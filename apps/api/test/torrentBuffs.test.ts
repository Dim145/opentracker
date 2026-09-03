import { describe, it, expect } from 'vitest';
import {
  best,
  buffLabel,
  IDENTITY,
  torrentMultipliers,
  volumeFactors,
} from '../utils/torrentBuffs';

// The API's half of a rule the Go tracker also implements
// (`apps/tracker/internal/bonus.Best`). These cases mirror `TestBest` there on
// purpose: two implementations of one rule drift, and the table is what catches
// it when only one side is changed.

const NEUTRAL = { downloadMultiplier: 100, uploadMultiplier: 100, multipliersUntil: null };

describe('torrentMultipliers', () => {
  it('reads the buff off the row', () => {
    expect(
      torrentMultipliers({ ...NEUTRAL, downloadMultiplier: 0 })
    ).toEqual({ download: 0, upload: 100 });
  });

  it('neutralises a lapsed buff', () => {
    const past = new Date('2020-01-01T00:00:00Z');
    expect(
      torrentMultipliers({
        downloadMultiplier: 0,
        uploadMultiplier: 200,
        multipliersUntil: past,
      })
    ).toEqual(IDENTITY);
  });

  it('honours a buff that has not lapsed yet', () => {
    const future = new Date(Date.now() + 60_000);
    expect(
      torrentMultipliers({
        downloadMultiplier: 0,
        uploadMultiplier: 100,
        multipliersUntil: future,
      })
    ).toEqual({ download: 0, upload: 100 });
  });

  it('treats a null end date as no end date', () => {
    expect(
      torrentMultipliers({
        downloadMultiplier: 50,
        uploadMultiplier: 100,
        multipliersUntil: null,
      })
    ).toEqual({ download: 50, upload: 100 });
  });
});

describe('best', () => {
  it('is the identity when nothing is running and nothing is buffed', () => {
    expect(best(IDENTITY, IDENTITY)).toEqual(IDENTITY);
  });

  it('takes the lower download and the higher upload', () => {
    // The case the product gets wrong: multiplying a site freeleech by a
    // per-torrent double upload would give upload 400 — credit nobody granted.
    expect(
      best({ download: 0, upload: 100 }, { download: 100, upload: 200 })
    ).toEqual({ download: 0, upload: 200 });
  });

  it('cannot be made worse by the stingier side', () => {
    expect(
      best({ download: 0, upload: 200 }, { download: 100, upload: 100 })
    ).toEqual({ download: 0, upload: 200 });
  });

  it('is commutative', () => {
    const a = { download: 50, upload: 150 };
    const b = { download: 0, upload: 100 };
    expect(best(a, b)).toEqual(best(b, a));
  });
});

describe('volumeFactors', () => {
  it('converts basis points to the plain factors Torznab wants', () => {
    expect(
      volumeFactors(
        { downloadMultiplier: 0, uploadMultiplier: 200, multipliersUntil: null },
        IDENTITY
      )
    ).toEqual({ downloadVolumeFactor: 0, uploadVolumeFactor: 2 });
  });

  it('lets two torrents in one response differ', () => {
    // Which is the whole point: these used to be one pair of numbers for the
    // entire page.
    const buffed = volumeFactors(
      { downloadMultiplier: 0, uploadMultiplier: 100, multipliersUntil: null },
      IDENTITY
    );
    const plain = volumeFactors(NEUTRAL, IDENTITY);
    expect(buffed.downloadVolumeFactor).toBe(0);
    expect(plain.downloadVolumeFactor).toBe(1);
  });

  it('still reflects a site-wide event on an unbuffed torrent', () => {
    expect(
      volumeFactors(NEUTRAL, { download: 0, upload: 200 })
    ).toEqual({ downloadVolumeFactor: 0, uploadVolumeFactor: 2 });
  });
});

describe('buffLabel', () => {
  it('names the two presets and the double upload', () => {
    expect(buffLabel({ ...NEUTRAL, downloadMultiplier: 0 })).toBe('freeleech');
    expect(buffLabel({ ...NEUTRAL, downloadMultiplier: 50 })).toBe('silverleech');
    expect(buffLabel({ ...NEUTRAL, uploadMultiplier: 200 })).toBe('double-upload');
  });

  it('falls back to `custom` for anything else', () => {
    expect(
      buffLabel({ downloadMultiplier: 25, uploadMultiplier: 150, multipliersUntil: null })
    ).toBe('custom');
  });

  it('is null when the torrent carries no buff of its own', () => {
    // Deliberately blind to site-wide events: a badge on one torrent among a
    // hundred has to mean THIS one.
    expect(buffLabel(NEUTRAL)).toBeNull();
  });

  it('is null once the buff has lapsed', () => {
    expect(
      buffLabel({
        downloadMultiplier: 0,
        uploadMultiplier: 100,
        multipliersUntil: new Date('2020-01-01T00:00:00Z'),
      })
    ).toBeNull();
  });
});
