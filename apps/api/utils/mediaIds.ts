/**
 * External media-database id normaliser (issue #47).
 *
 * The upload / edit forms accept anything the user has on the clipboard —
 * a raw id, a `tt`-prefixed IMDb id, a full URL — and we collapse it into
 * a canonical form before persisting. This keeps Torznab consumers
 * (Sonarr, Radarr, Lidarr) happy and avoids storing several variations
 * of the same value.
 *
 * Canonical forms:
 *   - IMDb : `ttNNNNNNN…` (the `tt` prefix is mandatory per the IMDb
 *     URL convention; Torznab consumers accept either form but the
 *     prefix is unambiguous).
 *   - TMDb : pure digits.
 *   - TVDB : pure digits.
 *
 * Returns `null` when the input doesn't look valid — callers can store
 * `null` in the column without a separate "is empty" flag.
 */

export type MediaIdKind = 'imdb' | 'tmdb' | 'tvdb';

export function normalizeImdbId(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Try a URL first (https://www.imdb.com/title/tt1234567/…) and fall
  // back to the bare id form (`tt1234567` or `1234567`).
  const fromUrl = trimmed.match(/imdb\.com\/title\/(tt\d{5,12})/i);
  if (fromUrl) return fromUrl[1]!.toLowerCase();
  const bare = trimmed.match(/^(?:tt)?(\d{5,12})$/i);
  if (bare) return `tt${bare[1]}`;
  return null;
}

function normalizeNumericId(
  input: unknown,
  hostPattern: RegExp,
  minDigits: number,
  maxDigits: number
): string | null {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(hostPattern);
  if (fromUrl) return fromUrl[1]!;
  const re = new RegExp(`^\\d{${minDigits},${maxDigits}}$`);
  if (re.test(trimmed)) return trimmed;
  return null;
}

export function normalizeTmdbId(input: unknown): string | null {
  // TMDb has TWO independent id namespaces — `/movie/{n}` and `/tv/{n}`
  // — and the same integer can resolve in both. Without a type hint
  // the lookup has to guess, which produces wrong matches when the
  // bare id happens to be a movie in one namespace and a TV show in
  // the other (issue raised in the issue thread). To let the operator
  // disambiguate at the source, we accept three input shapes and
  // preserve the prefix when present:
  //
  //   - "121361"             → "121361"          (bare; resolver guesses)
  //   - "tv/121361"          → "tv/121361"       (explicit)
  //   - "movie/121361"       → "movie/121361"    (explicit)
  //   - any themoviedb.org/{movie|tv}/N URL → "{type}/N"
  //
  // Downstream callers strip the prefix when they need just the digits
  // (e.g. Torznab attributes); the lookup util uses it to skip the
  // movie-then-tv probe.
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const fromUrl = trimmed.match(/themoviedb\.org\/(movie|tv)\/(\d{1,9})/i);
  if (fromUrl) return `${fromUrl[1]!.toLowerCase()}/${fromUrl[2]}`;

  const explicit = trimmed.match(/^(movie|tv)\/(\d{1,9})$/i);
  if (explicit) return `${explicit[1]!.toLowerCase()}/${explicit[2]}`;

  if (/^\d{1,9}$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * Strip the optional `tv/` / `movie/` prefix from a stored TMDb id.
 * Returns null if the input is null/blank, or empty if not a valid id.
 * Use this whenever a downstream consumer (Torznab, *Arr filters,
 * external links) wants the bare integer.
 */
export function tmdbIdBare(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const prefixed = stored.match(/^(?:movie|tv)\/(\d+)$/);
  if (prefixed) return prefixed[1]!;
  if (/^\d+$/.test(stored)) return stored;
  return null;
}

/**
 * Returns 'movie' / 'tv' if the id carries a type prefix, otherwise null.
 */
export function tmdbIdType(
  stored: string | null | undefined
): 'movie' | 'tv' | null {
  if (!stored) return null;
  const m = stored.match(/^(movie|tv)\//);
  return m ? (m[1]! as 'movie' | 'tv') : null;
}

export function normalizeTvdbId(input: unknown): string | null {
  // thetvdb.com URLs look like /series/<slug> *or* /dereferer/<id> —
  // the new GraphQL site exposes numeric ids in `?id=NNN` query params
  // and on legacy `/?tab=series&id=NNN`.
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const fromQuery = trimmed.match(/thetvdb\.com\/.*[?&]id=(\d{1,9})/i);
  if (fromQuery) return fromQuery[1]!;
  const fromPath = trimmed.match(/thetvdb\.com\/(?:series|movies)\/(\d{1,9})/i);
  if (fromPath) return fromPath[1]!;
  if (/^\d{1,9}$/.test(trimmed)) return trimmed;
  return null;
}

export function normalizeMediaId(
  kind: MediaIdKind,
  input: unknown
): string | null {
  switch (kind) {
    case 'imdb':
      return normalizeImdbId(input);
    case 'tmdb':
      return normalizeTmdbId(input);
    case 'tvdb':
      return normalizeTvdbId(input);
  }
}

/**
 * Public-facing URL for displaying a media id as a clickable link.
 */
export function mediaIdUrl(kind: MediaIdKind, id: string): string {
  switch (kind) {
    case 'imdb':
      return `https://www.imdb.com/title/${id}/`;
    case 'tmdb':
      // TMDb requires a type segment in the path; without context we
      // default to /movie/ which redirects to /tv/ if the id belongs
      // to a TV show.
      return `https://www.themoviedb.org/movie/${id}`;
    case 'tvdb':
      return `https://thetvdb.com/dereferrer/series/${id}`;
  }
}
