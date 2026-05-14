/**
 * GET /api/metadata/search?query=…&source=tmdb|igdb&type=movie|tv|game&year=YYYY
 *
 * Free-text search powering the upload form's title picker. The
 * form pre-populates `query` from the parsed release name; the
 * user can edit it. Returns up to 8 normalised hits — picking one
 * then drives a second `/api/metadata/lookup` call to resolve the
 * cross-database ids.
 *
 * `source` defaults to `tmdb` for backwards compatibility — the
 * upload picker passes it explicitly once the user has selected a
 * category (movie/tv → tmdb, game → igdb).
 *
 * Auth: any logged-in user. Rate-limited via the provider quotas
 * plus a Redis cache (see `searchMetadata` for TTLs).
 */
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import {
  ALL_SOURCE_IDS,
  isMetadataEnabled,
  isSourceEnabled,
  searchMetadata,
  type LookupSource,
} from '~~/utils/metadata';

const querySchema = z.object({
  query: z.string().min(1).max(120),
  source: z
    .enum(ALL_SOURCE_IDS as [LookupSource, ...LookupSource[]])
    .default('tmdb'),
  type: z.enum(['movie', 'tv', 'game']).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);

  if (!isMetadataEnabled()) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message:
        'Metadata search is not configured. Ask the operator to set TMDB_API_KEY (movies/TV) or IGDB_ID + IGDB_SECRET (games).',
      results: [],
    };
  }

  const { query, source, type, year } = querySchema.parse(getQuery(event));

  if (!isSourceEnabled(source)) {
    setResponseStatus(event, 503);
    return {
      enabled: false,
      message: `The ${source.toUpperCase()} integration is not configured.`,
      results: [],
    };
  }

  // Mirror the gating used elsewhere: read the canonical preference
  // from the row so flipping the toggle takes effect on the next
  // search without waiting for the cookie to refresh. Only TMDb
  // honours `include_adult` (IGDB has no equivalent flag), but we
  // still pass it through so a future provider can respect it.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, session.id),
    columns: { showAdultContent: true },
  });
  const includeAdult = me?.showAdultContent ?? false;

  const results = await searchMetadata(source, query, type, {
    year,
    includeAdult,
  });

  return {
    enabled: true,
    source,
    query,
    type: type ?? null,
    year: year ?? null,
    includeAdult,
    results,
  };
});
