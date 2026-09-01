export function formatSize(bytes: number): string {
  // Guards: negative or sub-byte values render as "0 B"; values past
  // PB clamp to the largest unit instead of indexing past the array
  // (the previous version returned "0.5 undefined" for bytes < 1 and
  // would crash on > PB).
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const raw = Math.floor(Math.log(bytes) / Math.log(1024));
  const i = Math.min(units.length - 1, Math.max(0, raw));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Day-precision date for membership / "since" labels — strips the time so
 * "Member since" doesn't read as "Mar 5, 2026, 04:32 PM" (the original
 * `formatDate` includes the minute, which is absurd for a join date).
 */
export function formatDay(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatAge(dateStr: string | Date | null | undefined): string {
  // Nullable because every caller already passes something nullable: a
  // release carries `moderatedAt ?? createdAt ?? null`, and an invalid Date
  // renders as "Invalid Date" rather than throwing — which is what the
  // callers have been relying on.
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  // A date in the future is not an age, and this function used to answer one
  // anyway: `diffInSeconds` goes negative, the first branch below catches it,
  // and every future date came back as "just now". That is how a live
  // freeleech with three days left rendered as "FREELEECH until just now" on
  // the busiest strip of a torrent page. Returning nothing is the honest
  // answer — the caller wanted a deadline, and `formatUntil` is the function
  // that gives one.
  if (diffInSeconds < 0) return '';

  if (diffInSeconds < 60) return 'just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 2592000)
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  if (diffInSeconds < 31536000)
    return `${Math.floor(diffInSeconds / 2592000)}mo ago`;
  return `${Math.floor(diffInSeconds / 31536000)}y ago`;
}

/**
 * How long ago, in the reader's language — `formatAge` for places that are
 * inside a translated sentence.
 *
 * `formatAge` returns `3d ago`, in English, always. Most of its callers put it
 * in a bare cell where that is survivable; the ones that interpolate it into a
 * message do not, and one of them produced `last 3d ago ago` in English and
 * `la dernière il y a 3d ago` in French. Because the direction is part of what
 * `Intl` returns, the surrounding message must not add its own "ago".
 */
export function formatAgo(
  dateStr: string | Date | null | undefined,
  locale = 'en'
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 60) return rtf.format(0, 'second');
  if (seconds < 3600) return rtf.format(-Math.round(seconds / 60), 'minute');
  if (seconds < 86400) return rtf.format(-Math.round(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(-Math.round(seconds / 86400), 'day');
  if (seconds < 31536000) return rtf.format(-Math.round(seconds / 2592000), 'month');
  return rtf.format(-Math.round(seconds / 31536000), 'year');
}

/**
 * How long is left, for a deadline — the mirror of `formatAge`.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled ladder, because unlike
 * `formatAge` (whose "3d ago" strings predate i18n on this codebase and are
 * baked into a dozen templates) this one is new and has no callers to keep
 * happy. It gives "in 3 days" / "dans 3 jours" from the browser, so a French
 * page stops carrying an English unit.
 *
 * A deadline already past returns nothing: a buff whose window closed is not a
 * buff, and the caller should stop drawing the badge rather than draw one that
 * says "3 days ago".
 */
export function formatUntil(
  dateStr: string | Date | null | undefined,
  locale = 'en'
): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const seconds = Math.floor((date.getTime() - Date.now()) / 1000);
  if (seconds <= 0) return '';

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (seconds < 3600) return rtf.format(Math.max(1, Math.round(seconds / 60)), 'minute');
  if (seconds < 86400) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (seconds < 2592000) return rtf.format(Math.round(seconds / 86400), 'day');
  if (seconds < 31536000) return rtf.format(Math.round(seconds / 2592000), 'month');
  return rtf.format(Math.round(seconds / 31536000), 'year');
}

/**
 * Strip every HTML tag from a string. Used to derive plain-text fallbacks
 * (page titles, placeholders) from the admin's rich-text settings.
 *
 * The naive single-pass `replace(/<[^>]*>/g, '')` lets crafted inputs slip
 * through — `<<script>script>` becomes `<script>` after one pass. We loop
 * until the string stops shrinking so the output is guaranteed to be
 * tag-free, regardless of nesting depth.
 */
export function stripTags(input: string | null | undefined): string {
  if (!input) return '';
  let s = input;
  let prev: string;
  do {
    prev = s;
    s = s.replace(/<[^>]*>/g, '');
  } while (s !== prev);
  return s;
}
