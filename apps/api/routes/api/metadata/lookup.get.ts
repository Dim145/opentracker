/**
 * GET /api/metadata/lookup?source=imdb|tmdb|tvdb|igdb&id=…
 *
 * Returns a normalised metadata payload (poster, overview, genres,
 * year, …) for the supplied external id. Dispatches to the source
 * registry — TMDb for movies / TV (via imdb / tmdb / tvdb sources),
 * IGDB for video games. The input id is normalised first so the
 * user can paste a full URL, a slug (IGDB), or a bare id.
 *
 * Auth: any logged-in user. Rate-limited by Redis cache + the
 * provider's own quota; we never expose API credentials to the
 * browser.
 */
import { z } from 'zod';
import {
  ALL_SOURCE_IDS,
  isMetadataEnabled,
  isSourceEnabled,
  lookupMetadata,
  normalizeSourceId,
  type LookupSource,
  type MediaTypeHint,
} from '~~/utils/metadata';

const querySchema = z.object({
  source: z.enum(ALL_SOURCE_IDS as [LookupSource, ...LookupSource[]]),
  id: z.string().min(1).max(128),
  // Optional type hint. The frontend derives this from the
  // torrent's category (Newznab 2xxx → movie, 5xxx → tv, 1xxx /
  // 4xxx → game).
  type: z.enum(['movie', 'tv', 'game']).optional(),
});

export default defineEventHandler(async (event) => {
  await requireUserSession(event);

  if (!isMetadataEnabled()) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message:
        'Metadata lookup is not configured. Ask the operator to set TMDB_API_KEY (movies/TV) or IGDB_ID + IGDB_SECRET (games).',
    };
  }

  const { source, id, type } = querySchema.parse(getQuery(event));

  if (!isSourceEnabled(source)) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message: `The ${source.toUpperCase()} integration is not configured.`,
    };
  }

  // Resolve raw URL / slug / id to the source-side canonical
  // form. IGDB does a network round-trip for slug→id; TMDb /
  // IMDb / TVDB resolve synchronously inside the call.
  const canonical = await normalizeSourceId(source, id);
  if (!canonical) {
    throw createError({
      statusCode: 400,
      message: `Could not parse a ${source.toUpperCase()} id from "${id}"`,
    });
  }

  const metadata = await lookupMetadata(
    source,
    canonical,
    type as MediaTypeHint | undefined
  );

  return {
    enabled: true,
    source,
    queriedId: canonical,
    found: metadata !== null,
    metadata,
  };
});
