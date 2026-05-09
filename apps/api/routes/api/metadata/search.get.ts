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
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { searchMetadata, isMetadataEnabled } from '~~/utils/metadata';

const querySchema = z.object({
  query: z.string().min(1).max(120),
  type: z.enum(['movie', 'tv']).optional(),
  year: z.coerce.number().int().min(1900).max(2100).optional(),
});

export default defineEventHandler(async (event) => {
  const { user: session } = await requireUserSession(event);

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

  // Mirror the gating used elsewhere: read the canonical preference
  // from the row so flipping the toggle takes effect on the next
  // search without waiting for the cookie to refresh. Users who
  // opted into adult content see TMDb's adult tree on /search/movie
  // and /search/tv; the rest get TMDb's default (adult hidden) so an
  // accidental query for an XXX title can't surface a poster on the
  // upload form.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, session.id),
    columns: { showAdultContent: true },
  });
  const includeAdult = me?.showAdultContent ?? false;

  const results = await searchMetadata(query, type, year, includeAdult);

  return {
    enabled: true,
    query,
    type: type ?? null,
    year: year ?? null,
    includeAdult,
    results,
  };
});
