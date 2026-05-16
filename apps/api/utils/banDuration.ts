/**
 * Ban-duration helpers — single source of truth for the
 * presets the report-acceptance flow offers, the labels we
 * surface in notifications, and the date math.
 *
 * Strings (not integers) on purpose: a `'permanent'` slot is
 * semantically distinct from "ban for N days", and presets
 * give the UI a fixed picker without the operator typing a
 * number. Adding a new preset is a one-line job here.
 */

export type BanDuration = '1d' | '7d' | '1m' | '1y' | 'permanent';

export const BAN_DURATIONS: readonly BanDuration[] = [
  '1d',
  '7d',
  '1m',
  '1y',
  'permanent',
] as const;

/**
 * Resolve a preset to an absolute `bannedUntil` date.
 *
 * Returns `null` for `'permanent'` — the schema treats a NULL
 * `banned_until` with `is_banned = true` as a permanent ban,
 * which the cron + lazy unban paths both honour.
 *
 * Month / year math uses native `Date` setters so DST and
 * end-of-month edge cases follow the same rules the user sees
 * everywhere else in the app (browser locale).
 */
export function computeBannedUntil(duration: BanDuration): Date | null {
  if (duration === 'permanent') return null;
  const d = new Date();
  switch (duration) {
    case '1d':
      d.setDate(d.getDate() + 1);
      return d;
    case '7d':
      d.setDate(d.getDate() + 7);
      return d;
    case '1m':
      d.setMonth(d.getMonth() + 1);
      return d;
    case '1y':
      d.setFullYear(d.getFullYear() + 1);
      return d;
  }
}
