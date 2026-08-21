/**
 * GET /api/torrents/groups
 *
 * The catalogue folded by work: one entry per film, per series, per game and
 * per book, with the ways it has been cut — episodes, season packs, integrals
 * — advertised on the row.
 *
 * Deliberately a separate route rather than a flag on the flat listing. That
 * handler is already carrying search, the fuzzy fallback, six exact-id lookups
 * and per-row swarm enrichment; a grouped branch inside it would have to skip
 * most of that anyway, since an infohash or an IMDb lookup returns a single
 * torrent and has nothing to group. The filters that DO make sense — search,
 * category, scope, adult gate, moderation visibility — are rebuilt here.
 *
 * No releases are returned. Rows arrive collapsed, and a member who never
 * expands one should not pay for a fan-out of sample queries and Redis reads
 * across twenty-five groups. `/api/torrents/group` serves one scope of one
 * group, which is the only moment those releases are worth fetching.
 *
 * Unapproved torrents are excluded outright, including from their own
 * uploader. The flat listing shows them so a member can find their pending
 * upload; a grouped view has no such job, and letting one leak in would show a
 * release count the rest of the site disagrees with.
 */
import { and, eq, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema, ftsVector } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import {
  FTS_CONFIG,
  parseSearchFields,
  toPrefixTsQuery,
} from '~~/utils/search';
import { adultCategoryIds } from '~~/utils/adultContent';
import { getSetting, SETTINGS_KEYS } from '~~/utils/server';
import { GROUP_SCOPES, listGroups } from '~~/utils/torrentGroups';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  search: z.string().trim().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  // The filter the flat listing cannot express: "show me the season packs" is
  // a question about how a release is cut, not about what it contains.
  scope: z.enum(GROUP_SCOPES as unknown as [string, ...string[]]).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const query = await getValidatedQuery(event, querySchema.parse);

  const conditions: SQL[] = [];

  // Adult gate, re-read from the row so the toggle takes effect on the very
  // next page rather than at the next login.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });
  if (!me?.showAdultContent) {
    const adultIds = await adultCategoryIds();
    if (adultIds.length > 0) {
      conditions.push(
        or(
          isNull(schema.torrents.categoryId),
          notInArray(schema.torrents.categoryId, adultIds),
        )!,
      );
    }
  }

  // Same subtree expansion the flat listing does: picking the "TV" root must
  // match the rows filed under TV/HD and TV/UHD, which is where they actually
  // live. A plain equality here matched only rows filed on the root itself,
  // i.e. none of them.
  if (query.categoryId) {
    const subcategories = await db.query.categories.findMany({
      where: eq(schema.categories.parentId, query.categoryId),
      columns: { id: true },
    });
    conditions.push(
      or(
        eq(schema.torrents.categoryId, query.categoryId),
        ...subcategories.map((sub) => eq(schema.torrents.categoryId, sub.id)),
      )!,
    );
  }

  // Search folds into the group filter: a group matches when ANY of its
  // releases matches, which is what `WHERE` before `GROUP BY` gives for free.
  if (query.search) {
    const tsq = toPrefixTsQuery(query.search);
    if (tsq) {
      const fields = parseSearchFields(
        await getSetting(SETTINGS_KEYS.SEARCH_FIELDS),
      );
      const q = sql`to_tsquery(${FTS_CONFIG}, ${tsq})`;
      const branches: SQL[] = [];
      if (fields.includes('name')) {
        branches.push(sql`${ftsVector(schema.torrents.name)} @@ ${q}`);
      }
      if (fields.includes('description')) {
        branches.push(sql`${ftsVector(schema.torrents.description)} @@ ${q}`);
      }
      if (fields.includes('nfo')) {
        branches.push(sql`${ftsVector(schema.torrents.nfo)} @@ ${q}`);
      }
      conditions.push(branches.length ? or(...branches)! : sql`false`);
    } else {
      // Nothing usable survived the scrub — return the unfiltered page rather
      // than an empty one, same as the flat listing.
    }
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const { groups, total } = await listGroups({
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    where,
    scope: query.scope as never,
  });

  return {
    groups,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / query.limit)),
    },
  };
});
