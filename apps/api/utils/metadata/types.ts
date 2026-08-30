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
/*
 * Aliased from the shared package, not re-exported from it.
 *
 * The definition lives in `packages/shared/src/media.ts` so the web renders
 * exactly the shape this produces — it used to keep seven hand-written
 * approximations of it. Nitro's auto-import scanner turns every export of
 * this file into a global, and it cannot follow an `export … from`: the
 * global and the direct import then resolve to two distinct symbols and
 * every provider fails to match its own `MediaSource` slot. A local alias
 * is a declaration, so the scanner sees it, and it is the shared type by
 * construction rather than a copy that can drift.
 */
import type {
  MediaMetadata as SharedMediaMetadata,
  MediaSourceId as SharedMediaSourceId,
  MediaTypeHint as SharedMediaTypeHint,
} from '@trackarr/shared/media';

export type MediaTypeHint = SharedMediaTypeHint;
export type MediaSourceId = SharedMediaSourceId;
export type MediaMetadata = SharedMediaMetadata;

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
export interface LookupOptions {
  /** Bundle locale of the requesting user (`en`, `fr`, …). TMDb
   *  honours this via its `language` query param; IGDB ignores it
   *  for now (no response-language axis on `/games`). */
  language?: string;
}

export interface SearchOptions extends LookupOptions {
  year?: number;
  includeAdult?: boolean;
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
  lookup(
    id: string,
    hint?: MediaTypeHint,
    options?: LookupOptions
  ): Promise<MediaMetadata | null>;
  search(
    query: string,
    hint?: MediaTypeHint,
    options?: SearchOptions
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
