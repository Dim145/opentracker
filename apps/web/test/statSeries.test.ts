import { describe, expect, it } from 'vitest';
import {
  BUCKET_ABOVE,
  BUCKET_SIZE,
  VIEW_H,
  VIEW_W,
  barGeometry,
  bucketLabels,
  bucketSums,
  shouldBucket,
} from '../app/utils/statSeries';
import {
  datetimeLocalToIso,
  formatAge,
  formatAgeCompact,
  formatAgo,
  formatSize,
  formatUntil,
  isoToDatetimeLocal,
} from '../app/utils/format';

// The traffic chart on /stats, and the three date formatters around it.
//
// Both halves of this file exist because of a defect that shipped, not because
// the arithmetic looked risky:
//
//   * The bar geometry floored a bar's width at 0.4 viewBox units. At the
//     365-day window a slot is 0.274 units, so every bar was 46 % wider than
//     its slot and painted over its neighbour — the chart rendered as one
//     filled rectangle and a member read a year of perfectly uniform traffic.
//
//   * `formatAge` answered a question about the future. Its diff goes negative,
//     the `< 60` branch caught it, and every date ahead of now came back as
//     "just now". A live freeleech with three days left therefore announced
//     itself on the busiest strip of a torrent page as "FREELEECH until just
//     now", and a member reasonably concluded the promotion was over.

describe('bar geometry', () => {
  const WINDOWS = [30, 90, 365, 1, 2, 7, 120, 121];

  it('never lets a bar overlap its neighbour', () => {
    for (const n of WINDOWS) {
      const points = Array.from({ length: n }, (_, i) => 1000 + i);
      const bars = barGeometry(points);
      expect(bars).toHaveLength(n);
      for (let i = 1; i < bars.length; i++) {
        const prev = bars[i - 1]!;
        // A hair of tolerance for float arithmetic; anything real is orders of
        // magnitude larger than this.
        expect(bars[i]!.x).toBeGreaterThanOrEqual(prev.x + prev.w - 1e-9);
      }
    }
  });

  it('keeps every bar inside the viewBox', () => {
    for (const n of WINDOWS) {
      const points = Array.from({ length: n }, (_, i) => i * 3);
      for (const bar of barGeometry(points)) {
        expect(bar.x).toBeGreaterThanOrEqual(0);
        expect(bar.x + bar.w).toBeLessThanOrEqual(VIEW_W + 1e-9);
        expect(bar.y).toBeGreaterThanOrEqual(0);
        expect(bar.y + bar.h).toBeLessThanOrEqual(VIEW_H + 1e-9);
      }
    }
  });

  it('anchors at zero, so a small value reads small', () => {
    // The bug this replaced: interpolating between the series min and max drew
    // an 11 % spread as a factor of a hundred, and made the quietest period
    // identical to a period with nothing at all.
    const [quiet, busy] = barGeometry([900, 1000]);
    expect(quiet!.h / busy!.h).toBeCloseTo(0.9, 2);
  });

  it('gives a period with nothing at all a height of zero', () => {
    const [nothing, some] = barGeometry([0, 500]);
    expect(nothing!.h).toBe(0);
    expect(some!.h).toBeGreaterThan(0);
  });

  it('survives a flat series and an empty one', () => {
    expect(barGeometry([])).toEqual([]);
    for (const bar of barGeometry([0, 0, 0])) expect(bar.h).toBe(0);
  });
});

describe('bucketing', () => {
  it('kicks in only past the threshold', () => {
    expect(shouldBucket(BUCKET_ABOVE)).toBe(false);
    expect(shouldBucket(BUCKET_ABOVE + 1)).toBe(true);
    expect(shouldBucket(90)).toBe(false);
  });

  it('turns a year of days into a readable number of bars', () => {
    const year = Array.from({ length: 365 }, () => 1);
    const buckets = bucketSums(year);
    expect(buckets).toHaveLength(Math.ceil(365 / BUCKET_SIZE));
    expect(buckets.length).toBeLessThan(60);
    // And once bucketed, the bars fit.
    const bars = barGeometry(buckets);
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i]!.x).toBeGreaterThanOrEqual(bars[i - 1]!.x + bars[i - 1]!.w - 1e-9);
    }
  });

  it('loses nothing: the buckets sum to the input', () => {
    const points = Array.from({ length: 365 }, (_, i) => i * 7 + 3);
    const total = points.reduce((a, b) => a + b, 0);
    expect(bucketSums(points).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('labels a bucket with its first day', () => {
    const labels = Array.from({ length: 15 }, (_, i) => `d${i}`);
    expect(bucketLabels(labels)).toEqual(['d0', 'd7', 'd14']);
  });
});

describe('date formatters', () => {
  const inThreeDays = new Date(Date.now() + 3 * 86400_000).toISOString();
  const threeDaysAgo = new Date(Date.now() - 3 * 86400_000).toISOString();

  it('refuses to describe a future date as an age', () => {
    // The exact shape of the shipped bug.
    expect(formatAge(inThreeDays)).toBe('');
    expect(formatAge(inThreeDays)).not.toBe('just now');
  });

  it('still reads a past date as an age, in the reader\u2019s language', () => {
    // `formatAge` déléguait à une échelle anglaise en dur (`3d ago`) sur une
    // cinquantaine d'appels, dont la colonne ÂGE du catalogue. Elle passe
    // désormais par `Intl`, donc la sortie suit la locale.
    expect(formatAge(threeDaysAgo, 'en')).toMatch(/3 days ago/);
    expect(formatAge(threeDaysAgo, 'fr')).toMatch(/il y a 3 jours/);
    expect(formatAge(null)).toBe('');
  });

  it('leaves the compact English ladder available for a fixed-width column', () => {
    expect(formatAgeCompact(threeDaysAgo)).toBe('3d ago');
    expect(formatAgeCompact(inThreeDays)).toBe('');
  });

  it('labels a binary division with binary units', () => {
    // `KB` sur une division par 1024 est la mauvaise étiquette : 1024 octets
    // font un kibioctet. Et `toFixed(1)` codait le point décimal en dur.
    expect(formatSize(1024, 'en')).toBe('1.0 KiB');
    expect(formatSize(1024 * 1024 * 4.5, 'en')).toBe('4.5 MiB');
    expect(formatSize(1024 * 1024 * 4.5, 'fr')).toMatch(/4,5 MiB/);
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(-1)).toBe('0 B');
  });

  it('reads a deadline forwards, in the reader’s language', () => {
    expect(formatUntil(inThreeDays, 'en')).toMatch(/in 3 days/);
    expect(formatUntil(inThreeDays, 'fr')).toMatch(/dans 3 jours/);
  });

  it('says nothing about a deadline already past', () => {
    // So a caller stops drawing a badge instead of drawing "3 days ago" in it.
    expect(formatUntil(threeDaysAgo)).toBe('');
    expect(formatUntil(null)).toBe('');
    expect(formatUntil('not a date')).toBe('');
  });

  it('carries its own direction, so a message must not add "ago"', () => {
    // `alerts.lastMatch` used to be "last {when} ago" around a value that
    // already ended in "ago", giving "last 3d ago ago" — and, in French, an
    // English unit inside a French sentence.
    expect(formatAgo(threeDaysAgo, 'en')).toMatch(/3 days ago/);
    expect(formatAgo(threeDaysAgo, 'fr')).toMatch(/il y a 3 jours/);
    expect(formatAgo(threeDaysAgo, 'en')).not.toMatch(/ago ago/);
  });

  it('does not put a past-tense phrase on a future date', () => {
    expect(formatAgo(inThreeDays, 'en')).toMatch(/now/);
  });
});

describe('datetime-local round trip', () => {
  // Le défaut expédié : la page d'un torrent alimentait son champ d'échéance
  // avec `toISOString().slice(0, 16)`, c'est-à-dire l'heure UTC, dans une
  // entrée qui affiche et relit de l'heure locale. Enregistrer sans rien
  // toucher reculait donc l'échéance du décalage horaire — deux heures par
  // sauvegarde à Paris l'été, jusqu'à ce qu'une promotion en cours se retrouve
  // datée d'hier.
  it('leaves an instant untouched when nothing is edited', () => {
    const iso = new Date('2026-07-14T16:30:00.000Z').toISOString();
    const back = datetimeLocalToIso(isoToDatetimeLocal(iso));
    expect(back).toBe(iso);
  });

  it('writes the local wall clock, not the UTC one', () => {
    const d = new Date('2026-07-14T16:30:00.000Z');
    const shown = isoToDatetimeLocal(d.toISOString());
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(shown).toBe(
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`,
    );
  });

  it('survives a full year of instants, DST changeovers included', () => {
    // L'arithmétique sur `getTimezoneOffset()` — l'autre correctif possible —
    // se trompe deux fois par an. Les accesseurs locaux, non.
    for (let day = 0; day < 365; day += 1) {
      const iso = new Date(Date.UTC(2026, 0, 1, 3, 45) + day * 86400_000).toISOString();
      expect(datetimeLocalToIso(isoToDatetimeLocal(iso))).toBe(iso);
    }
  });

  it('says nothing about an absent or unreadable date', () => {
    expect(isoToDatetimeLocal(null)).toBe('');
    expect(isoToDatetimeLocal('')).toBe('');
    expect(isoToDatetimeLocal('not a date')).toBe('');
    expect(datetimeLocalToIso('')).toBeNull();
    expect(datetimeLocalToIso('not a date')).toBeNull();
  });
});
