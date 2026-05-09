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

export function formatAge(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

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
