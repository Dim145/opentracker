/**
 * Detect an external media id (IMDb / TMDb / TVDB) from arbitrary user
 * input — used by the search bar so a pasted URL or bare `tt…` id
 * automatically switches the listing into "search by id" mode without
 * needing a separate filter UI.
 *
 * Mirrors the server-side `normalizeMediaId` patterns. We're
 * deliberately conservative about ambiguous input (a bare integer
 * could be TMDb or TVDB or just a number a user typed), so:
 *
 *   - Anything matching an IMDb URL or `tt\d+` form → 'imdb'
 *   - A themoviedb.org URL with `/movie/` or `/tv/` → 'tmdb' (with
 *     namespace prefix preserved so the search hits the right scope)
 *   - A thetvdb.com URL → 'tvdb'
 *   - Bare digits with no other context → null (text search)
 *
 * The bare-digit case is the trickiest: pasting "tt0133093" should
 * trigger detection but pasting "1999" (a year) should not. The `tt`
 * prefix is the unambiguous signal for IMDb; for TMDb/TVDB we
 * exclusively rely on URLs.
 */

export type MediaIdSource = 'imdb' | 'tmdb' | 'tvdb';

export interface DetectedMediaId {
  source: MediaIdSource;
  /** Canonical id for the API call (IMDb keeps `tt`, TMDb may keep type prefix). */
  id: string;
  /** Pretty form for UI badges — bare digits for TMDb/TVDB, `tt…` for IMDb. */
  display: string;
  /** Short label for the chip ("IMDb", "TMDb", "TVDB"). */
  label: string;
}

const IMDB_URL = /imdb\.com\/title\/(tt\d{5,12})/i;
const IMDB_BARE = /^(?:tt)(\d{5,12})$/i;
const TMDB_URL = /themoviedb\.org\/(movie|tv)\/(\d{1,9})/i;
const TVDB_URL_QUERY = /thetvdb\.com\/.*[?&]id=(\d{1,9})/i;
const TVDB_URL_PATH = /thetvdb\.com\/(?:series|movies)\/(\d{1,9})/i;

export function detectMediaId(input: string): DetectedMediaId | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  let m = trimmed.match(IMDB_URL);
  if (m) {
    const id = m[1].toLowerCase();
    return { source: 'imdb', id, display: id, label: 'IMDb' };
  }
  m = trimmed.match(IMDB_BARE);
  if (m) {
    const id = `tt${m[1]}`;
    return { source: 'imdb', id, display: id, label: 'IMDb' };
  }
  m = trimmed.match(TMDB_URL);
  if (m) {
    const type = m[1].toLowerCase();
    const id = `${type}/${m[2]}`;
    return { source: 'tmdb', id, display: m[2], label: 'TMDb' };
  }
  // Round-trip: when the user reloads a `?tmdbid=tv/121361` URL we
  // need to recognise the prefixed form too, otherwise the active
  // chip shows the raw string instead of bare digits.
  m = trimmed.match(/^(?:movie|tv)\/(\d{1,9})$/i);
  if (m) {
    return { source: 'tmdb', id: trimmed, display: m[1], label: 'TMDb' };
  }
  m = trimmed.match(TVDB_URL_QUERY) ?? trimmed.match(TVDB_URL_PATH);
  if (m) {
    const id = m[1];
    return { source: 'tvdb', id, display: id, label: 'TVDB' };
  }
  return null;
}

/**
 * Map a detected source onto the API query-param name. Kept as a
 * helper so callers don't sprinkle the literal strings around.
 */
export function mediaIdQueryParam(
  source: MediaIdSource
): 'imdbid' | 'tmdbid' | 'tvdbid' {
  return `${source}id` as 'imdbid' | 'tmdbid' | 'tvdbid';
}
