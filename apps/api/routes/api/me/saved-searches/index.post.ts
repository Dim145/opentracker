/**
 * POST /api/me/saved-searches
 *
 * Store a filter. The body is the listing's own vocabulary — the same
 * parameters `/api/torrents` accepts — so the page can hand over whatever the
 * member currently has on screen without translating anything.
 *
 * ## Two refusals worth their code
 *
 * **A filter with no criteria at all** would match every upload forever, which
 * is not a saved search but a firehose. Refused with a message that says what
 * to add rather than a generic 400.
 *
 * **A cap per member.** Every armed filter is evaluated against every accepted
 * upload, so the cost of the feature is the number of armed filters across the
 * site. A ceiling somebody chose beats one that emerges at three in the
 * morning.
 */
import { and, count, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import { toExactTsQuery } from '~~/utils/search';
import { slugifyTag } from '~~/utils/tags';
import { normalizeMediaId, tmdbIdBare } from '~~/utils/mediaIds';
import { getSavedSearchMaxPerUser } from '~~/utils/settings';

const bodySchema = z.object({
  label: z.string().trim().min(1).max(80),
  query: z.string().trim().max(255).optional(),
  categoryId: z.string().max(128).optional(),
  /** Tag slugs or names — `slugifyTag` resolves both, as the listing does. */
  tags: z.array(z.string().max(64)).max(10).optional(),
  imdbId: z.string().max(64).optional(),
  tmdbId: z.string().max(64).optional(),
  tvdbId: z.string().max(64).optional(),
  notify: z.boolean().optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);

  const tags = (body.tags ?? []).map(slugifyTag).filter(Boolean);
  const query = body.query?.trim() || null;
  const tsquery = query ? toExactTsQuery(query) : null;
  const imdbId = body.imdbId ? normalizeMediaId('imdb', body.imdbId) : null;
  const tmdbId = body.tmdbId ? tmdbIdBare(body.tmdbId) : null;
  const tvdbId = body.tvdbId?.trim() || null;
  const categoryId = body.categoryId?.trim() || null;

  // `query` without a usable tsquery means the member typed only punctuation —
  // it looks like a criterion and matches nothing, so it does not count as one.
  const hasCriteria =
    !!tsquery || !!categoryId || tags.length > 0 || !!imdbId || !!tmdbId || !!tvdbId;
  if (!hasCriteria) {
    throw createError({
      statusCode: 400,
      message:
        'A saved search needs at least one criterion — some text, a category, a tag or a media id.',
    });
  }

  const max = await getSavedSearchMaxPerUser();
  const [{ value: existing } = { value: 0 }] = await db
    .select({ value: count() })
    .from(schema.savedSearches)
    .where(eq(schema.savedSearches.userId, user.id));
  if (existing >= max) {
    throw createError({
      statusCode: 400,
      message: `You can keep up to ${max} saved searches. Delete one first.`,
    });
  }

  const id = randomUUID();
  await db.insert(schema.savedSearches).values({
    id,
    userId: user.id,
    label: body.label,
    query,
    tsquery,
    categoryId,
    tags: tags.length ? tags : null,
    imdbId,
    tmdbId,
    tvdbId,
    notify: body.notify ?? true,
  });

  return { id, success: true };
});
