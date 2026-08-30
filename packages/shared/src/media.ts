/**
 * The metadata wire shape, shared by the API that produces it and the web
 * that renders it.
 *
 * It used to live only in `apps/api/utils/metadata/types.ts`, and the web
 * carried SEVEN hand-written approximations of it — one in the picker, one
 * in each of the three cards, and one in each of the three pages that pass
 * a result from the first to the others. They had drifted: the picker
 * declared five identity fields and an index signature, the cards demanded
 * the full display shape, and nothing checked either. One definition, so
 * the drift cannot come back.
 */

export type MediaTypeHint = 'movie' | 'tv' | 'game' | 'book';

/** Stable identifiers for every source. Add a literal here when
 *  you wire a new provider into `index.ts`. */
export type MediaSourceId =
  | 'tmdb'
  | 'imdb'
  | 'tvdb'
  | 'igdb'
  | 'openlibrary';

/**
 * Normalised detail payload returned by `lookup()`. Every provider
 * fills `source`, `type`, `title`, `url`; the rest is best-effort
 * and may be null. Provider-specific fields live under their own
 * id key (`tmdbId`, `igdbId`, …) so the wire shape is still typed
 * even with multiple providers.
 */
export interface MediaMetadata {
  source: MediaSourceId;
  type: MediaTypeHint;
  /** Provider-side canonical id, also surfaced as one of the
   *  typed slots below depending on the source. */
  title: string;
  originalTitle: string | null;
  tagline: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  /** Minutes; for TV this is the per-episode runtime. Null for
   *  games / other types. */
  runtime: number | null;
  /** 0–10 IMDb-style or 0–100 IGDB-style; the provider normalises
   *  to 0–10 so the UI can render one scale. */
  voteAverage: number | null;
  voteCount: number | null;
  url: string;

  /** Raw release date (YYYY-MM-DD) — the listing spells it out in full. */
  releaseDate?: string | null;
  countries?: string[];
  /** Director(s) for a film, creator(s) for a series. */
  directors?: string[];
  cast?: Array<{ name: string; character: string | null; photoUrl: string | null }>;
  seasonCount?: number | null;
  episodeCount?: number | null;

  // ── Source-specific typed slots ────────────────────────────
  // Filled by the relevant provider; null otherwise. The Torznab /
  // *Arr cross-reference uses these to match against the user's
  // library.
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  igdbId?: number | null;
  /** Book-only — canonical Open Library work id (`OL\d+W`). */
  openlibraryId?: string | null;
  /** Game-only — release platform names ("PlayStation 5", "PC", …). */
  platforms?: string[];
  /** Game-only — single-player / multiplayer / co-operative tags. */
  gameModes?: string[];
  /** Game-only — high-resolution screenshots. */
  screenshots?: string[];
  /** Game-only — IGDB-side first-release date as ISO if any
   *  region has shipped. */
  firstReleaseDate?: string | null;
  /** Book-only — surfaced author names in publication order. */
  authors?: string[];
  /** Book-only — publisher name (best-effort across providers). */
  publisher?: string | null;
  /** Book-only — page count for the canonical edition. */
  pageCount?: number | null;
  /** Book-only — ISBN-13 if Open Library / Google Books had it. */
  isbn13?: string | null;
  /** Book-only — ISBN-10 if available; useful for legacy catalogues. */
  isbn10?: string | null;
  /** Book-only — which provider actually resolved this record
   *  ('openlibrary' or 'googlebooks'). Lets the UI surface the
   *  origin alongside the canonical 'source: openlibrary' header. */
  bookProvider?: 'openlibrary' | 'googlebooks';
}

/** Lighter shape returned by `search()` for the upload-form picker. */
export interface MediaSearchHit {
  source: MediaSourceId;
  type: MediaTypeHint;
  /** Provider canonical id (string for portability; the lookup
   *  endpoint re-resolves to the typed payload). */
  id: string;
  title: string;
  originalTitle: string | null;
  year: number | null;
  overview: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  url: string;
}

/**
 * Provider-side request options shared by both `lookup` and `search`.
 * Optional throughout — providers that don't speak the relevant axis
 * (e.g. IGDB has no response-language knob) silently no-op while
 * keeping the wire shape consistent.
 */
