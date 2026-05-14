/**
 * Metadata façade.
 *
 * Single import surface for the routes — `import { lookupMetadata,
 * searchMetadata, isMetadataEnabled } from '../utils/metadata'`.
 * The registry below maps `source` ids to `MediaSource`
 * implementations. Adding a new provider is one entry here plus
 * a new file in this directory.
 */
import { imdbSource, tmdbSource, tvdbSource } from './tmdb';
import { igdbSource } from './igdb';
import type {
  MediaMetadata,
  MediaSearchHit,
  MediaSource,
  MediaSourceId,
  MediaTypeHint,
} from './types';

export type {
  MediaMetadata,
  MediaSearchHit,
  MediaSourceId,
  MediaTypeHint,
} from './types';

const REGISTRY: Record<MediaSourceId, MediaSource> = {
  tmdb: tmdbSource,
  imdb: imdbSource,
  tvdb: tvdbSource,
  igdb: igdbSource,
};

export const ALL_SOURCE_IDS = Object.keys(REGISTRY) as MediaSourceId[];

/** Backwards-compat alias for the route — the original module
 *  exported `LookupSource` covering imdb/tmdb/tvdb. The new
 *  superset adds 'igdb'. */
export type LookupSource = MediaSourceId;

export function getSource(id: MediaSourceId): MediaSource {
  const src = REGISTRY[id];
  if (!src) {
    throw createError({
      statusCode: 400,
      message: `Unknown metadata source: ${id}`,
    });
  }
  return src;
}

/**
 * True when at least one provider in the registry is configured.
 * Routes use this to short-circuit with a friendlier 503 message
 * instead of dispatching to a disabled provider.
 */
export function isMetadataEnabled(): boolean {
  return ALL_SOURCE_IDS.some((id) => REGISTRY[id].isEnabled());
}

/** Whether a specific source is configured. */
export function isSourceEnabled(id: MediaSourceId): boolean {
  return REGISTRY[id]?.isEnabled() ?? false;
}

/**
 * Look up metadata by an external id. Dispatches to the source
 * registry; missing credentials surface a 503 createError out of
 * the source-specific helper.
 */
export async function lookupMetadata(
  source: MediaSourceId,
  id: string,
  hint?: MediaTypeHint
): Promise<MediaMetadata | null> {
  const src = getSource(source);
  return src.lookup(id, hint);
}

/**
 * Free-text search. Some sources (IMDb, TVDB) have no public
 * search and return an empty array — that's intentional, the
 * route doesn't need to special-case them.
 */
export async function searchMetadata(
  source: MediaSourceId,
  query: string,
  hint?: MediaTypeHint,
  options?: { year?: number; includeAdult?: boolean }
): Promise<MediaSearchHit[]> {
  const src = getSource(source);
  return src.search(query, hint, options);
}

/**
 * Resolve raw user input (URL / slug / id) into the source-side
 * canonical id. Some providers (IGDB slug resolve) do this
 * asynchronously, so the helper always returns a Promise.
 */
export async function normalizeSourceId(
  source: MediaSourceId,
  input: unknown
): Promise<string | null> {
  return getSource(source).normalizeId(input);
}
