/**
 * GET /api/metadata/search?query=…&type=movie|tv&year=YYYY
 *
 * Free-text search powering the upload form's title picker. The form
 * pre-populates `query` from the parsed release name; the user can also
 * edit it. Returns up to 8 normalised hits — picking one then drives a
 * second `/api/metadata/lookup` call to resolve the cross-database ids.
 *
 * Auth: any logged-in user. Rate-limited via TMDb's per-key quota plus
 * a Redis cache (see `searchMetadata` for TTLs).
 */
import { z } from 'zod';
import { searchMetadata, isMetadataEnabled } from '~~/utils/metadata';

const querySchema = z.object({
  query: z.string().min(1).max(120),
  type: z.enum(['movie', 'tv']).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

export default defineEventHandler(async (event) => {
  await requireUserSession(event);

  if (!isMetadataEnabled()) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message:
        'Metadata search is not configured. Ask the operator to set TMDB_API_KEY.',
      results: [],
    };
  }

  const { query, type, year } = querySchema.parse(getQuery(event));
  const results = await searchMetadata(query, type, year);

  return {
    enabled: true,
    query,
    type: type ?? null,
    year: year ?? null,
    results,
  };
});
