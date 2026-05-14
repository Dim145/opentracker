/**
 * Coerce a server-supplied URL to a safe in-app path.
 *
 * The notification feed lets the API store an arbitrary `link`
 * string per row; we hand that string to `router.push` whenever the
 * user clicks the row. Vue Router treats anything string-shaped as
 * an in-app path so `javascript:` will silently no-op — but two
 * shapes are still dangerous:
 *
 *   - `//evil.tld/...` — protocol-relative; the browser will treat
 *     `//x` inside the URL bar as a network reference to `x` and
 *     navigate off-origin.
 *   - `https://evil.tld/...` — same deal, just spelled out.
 *
 * This helper returns `link` only when it points at a route on the
 * current site; anything else collapses to `'/'`. It's intentionally
 * conservative: a non-`/`-leading value is rejected too, because the
 * router resolves bare strings against the active route which makes
 * `evil` smuggling possible.
 */
export function safeInAppPath(link: string | null | undefined): string {
  if (!link || typeof link !== 'string') return '/';
  // Reject protocol-relative URLs outright — anything starting with
  // `//` cannot be a same-origin in-app path.
  if (link.startsWith('//')) return '/';
  // Absolute path is the only shape we accept.
  if (!link.startsWith('/')) return '/';
  // Try resolving against our origin so we catch the weird cases
  // (e.g. `/\\evil.tld` interpreted as a backslash-escaped path on
  // some browsers, or `/../../` traversal). When the URL doesn't
  // parse, default to '/'.
  if (typeof window !== 'undefined') {
    try {
      const url = new URL(link, window.location.origin);
      if (url.origin !== window.location.origin) return '/';
      return url.pathname + url.search + url.hash;
    } catch {
      return '/';
    }
  }
  // SSR: the basic prefix checks above are enough.
  return link;
}
