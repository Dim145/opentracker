/**
 * Shared types for the metadata-source abstraction.
 *
 * Each external provider (TMDb, IGDB, …) implements `MediaSource`.
 * The façade at `./index.ts` keeps a registry of enabled sources
 * and dispatches lookup / search calls by `source` id.
 *
 * The wire shapes (`MediaMetadata`, `MediaSearchHit`) are
 * intentionally a UNION of every field any provider can ship, so
 * the frontend cards can render any source without a discriminated
 * payload format. Type-specific renderers select the fields they
 * care about; absent ones are simply null.
 */

/**
 * High-level "what kind of thing is this?" — drives:
 *   - which source(s) can handle the lookup,
 *   - how the upload form's media-id picker pre-selects a tab,
 *   - which metadata card the torrent detail page renders.
 */
export type MediaTypeHint = 'movie' | 'tv' | 'game';

/** Stable identifiers for every source. Add a literal here when
 *  you wire a new provider into `index.ts`. */
export type MediaSourceId = 'tmdb' | 'imdb' | 'tvdb' | 'igdb';

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

  // ── Source-specific typed slots ────────────────────────────
  // Filled by the relevant provider; null otherwise. The Torznab /
  // *Arr cross-reference uses these to match against the user's
  // library.
  tmdbId?: number | null;
  imdbId?: string | null;
  tvdbId?: number | null;
  igdbId?: number | null;
  /** Game-only — release platform names ("PlayStation 5", "PC", …). */
  platforms?: string[];
  /** Game-only — single-player / multiplayer / co-operative tags. */
  gameModes?: string[];
  /** Game-only — high-resolution screenshots. */
  screenshots?: string[];
  /** Game-only — IGDB-side first-release date as ISO if any
   *  region has shipped. */
  firstReleaseDate?: string | null;
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
 * Every provider implements this contract. The façade only ever
 * calls these methods — `lookup` and `search` decide internally
 * whether to hit the network, the cache, or both.
 */
export interface MediaSource {
  /** Stable identifier used as the `source` query param. */
  readonly id: MediaSourceId;
  /** Display-friendly label for the upload form picker. */
  readonly label: string;
  /** Which `MediaTypeHint`s this source can serve. The registry
   *  uses this to filter when a hint is supplied. */
  readonly handles: ReadonlyArray<MediaTypeHint>;
  /** Whether the operator has configured the required env vars. */
  isEnabled(): boolean;
  /** Collapse user input (URL, slug, bare id) into the canonical
   *  storage form, or null when the input doesn't look valid.
   *  May hit the network for slug→id resolves; callers should
   *  treat the call as async. */
  normalizeId(input: unknown): Promise<string | null>;
  lookup(id: string, hint?: MediaTypeHint): Promise<MediaMetadata | null>;
  search(
    query: string,
    hint?: MediaTypeHint,
    options?: { year?: number; includeAdult?: boolean }
  ): Promise<MediaSearchHit[]>;
}

/**
 * Shared cache TTLs used by every provider. Centralising them keeps
 * the source modules from drifting on hit/miss policy.
 */
export const META_TTL = {
  /** Positive hits — metadata is fairly stable. */
  POS_S: 60 * 60 * 24,
  /** Misses — short so an operator can fix a typo without restarting. */
  NEG_S: 60 * 60,
  /** Search caches — fresh enough for poster swaps. */
  SEARCH_S: 60 * 60 * 6,
} as const;

export const NEG_SENTINEL = '__null__';
