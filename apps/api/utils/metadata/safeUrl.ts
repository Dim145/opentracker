/**
 * Return `candidate` only when it is an absolute http(s) URL; otherwise
 * fall back to the (always-safe, hardcoded) `fallback`.
 *
 * Provider `url` fields come from third-party APIs (IGDB, Google Books,
 * Open Library) and are rendered as clickable links on the torrent
 * detail / upload / edit pages. A `javascript:` / `data:` value would be
 * a stored-XSS vector if a provider were hostile, MITM'd, or its cached
 * response poisoned (finding L27). Filtering the scheme at the
 * normalizer is the single choke point that keeps every consumer safe.
 */
export function safeHttpUrl(candidate: unknown, fallback: string): string {
  if (typeof candidate === 'string') {
    try {
      const u = new URL(candidate);
      if (u.protocol === 'http:' || u.protocol === 'https:') {
        return candidate;
      }
    } catch {
      // Not a valid absolute URL — fall through to the safe template.
    }
  }
  return fallback;
}
