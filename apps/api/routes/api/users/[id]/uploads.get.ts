import { db, schema } from '@trackarr/db';
import { and, eq, desc, sql, or, isNull, notInArray } from 'drizzle-orm';
import { getStats } from '~~/utils/server';
import { adultCategoryIds } from '~~/utils/adultContent';
import { z } from 'zod';

const paramsSchema = z.object({
  id: z.string().min(1),
});

const querySchema = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(25),
});

export default defineEventHandler(async (event) => {
  const { user: viewer } = await requireUserSession(event);

  const params = paramsSchema.parse(getRouterParams(event));
  const query = querySchema.parse(getQuery(event));

  const offset = (query.page - 1) * query.limit;

  // Verify user exists
  const user = await db.query.users.findFirst({
    where: eq(schema.users.id, params.id),
    columns: { id: true },
  });

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found',
    });
  }

  // Visibility filter on moderation status:
  //   - the uploader themselves see every row (incl. pending /
  //     changes_requested / rejected) so /me lists them all
  //   - staff see every row regardless of whose profile they're on
  //   - everyone else only sees `accepted` rows on a profile page
  const isSelf = viewer.id === params.id;
  const isStaff = !!(viewer.isAdmin || viewer.isModerator);
  const seeAll = isSelf || isStaff;
  const baseFilter = eq(schema.torrents.uploaderId, params.id);
  const conditions = [baseFilter];
  if (!seeAll) {
    conditions.push(eq(schema.torrents.moderationStatus, 'accepted'));
    // Adult gate — mirror the listing/detail/RSS/Torznab surfaces so a
    // non-opted-in viewer can't enumerate another user's XXX uploads here
    // (finding L3). Self/staff keep full visibility.
    const me = await db.query.users.findFirst({
      where: eq(schema.users.id, viewer.id),
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
  }
  const where = and(...conditions);

  // Get user's uploads
  const torrents = await db.query.torrents.findMany({
    where,
    with: {
      category: true,
    },
    orderBy: [desc(schema.torrents.createdAt)],
    limit: query.limit,
    offset,
  });

  // Get total count
  const countResult = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.torrents)
    .where(where);

  const total = countResult[0]?.count || 0;

  // Enrich with live stats from Redis
  const enriched = await Promise.all(
    torrents.map(async (torrent) => {
      const stats = await getStats(torrent.infoHash);
      return {
        ...torrent,
        stats: {
          seeders: stats.seeders,
          leechers: stats.leechers,
          completed: stats.completed,
        },
      };
    })
  );

  return {
    data: enriched,
    pagination: {
      page: query.page,
      limit: query.limit,
      total,
      pages: Math.ceil(total / query.limit),
    },
  };
});
