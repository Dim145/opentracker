/**
 * GET /api/metadata/lookup?source=imdb|tmdb|tvdb&id=…
 *
 * Returns a normalised metadata payload (poster, overview, genres,
 * year, …) for the supplied external id. Looks up via TMDb; the input
 * id is normalised first so the user can paste a full URL or a bare id.
 *
 * Auth: any logged-in user. The lookup is rate-limited by Redis cache
 * + TMDb's own quota; we don't expose the API key to the browser.
 */
import { z } from 'zod';
import {
  lookupMetadata,
  isMetadataEnabled,
  type LookupSource,
  type MediaTypeHint,
} from '~~/utils/metadata';
import { normalizeMediaId } from '~~/utils/mediaIds';

const querySchema = z.object({
  source: z.enum(['imdb', 'tmdb', 'tvdb']),
  id: z.string().min(1).max(64),
  // Optional type hint. The frontend derives this from the torrent's
  // category (Newznab 2xxx → movie, 5xxx → tv); the operator can also
  // bake it into a TMDb id directly as `tv/N` / `movie/N`.
  type: z.enum(['movie', 'tv']).optional(),
});

export default defineEventHandler(async (event) => {
  await requireUserSession(event);

  // Don't even validate inputs if integration is off — keeps the
  // 503 response message readable in browser devtools.
  if (!isMetadataEnabled()) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message:
        'Metadata lookup is not configured. Ask the operator to set TMDB_API_KEY.',
    };
  }

  const { source, id, type } = querySchema.parse(getQuery(event));

  // Normalise via the shared util so URL forms ("https://imdb.com/…") and
  // bare digits all collapse to the canonical id before we hit Redis.
  const canonical = normalizeMediaId(source as LookupSource, id);
  if (!canonical) {
    throw createError({
      statusCode: 400,
      message: `Could not parse a ${source.toUpperCase()} id from "${id}"`,
    });
  }

  const metadata = await lookupMetadata(
    source as LookupSource,
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
