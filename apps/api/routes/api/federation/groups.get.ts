/**
 * GET /api/federation/groups — authenticated, local.
 *
 * The federated mirror folded by work, exactly as `/api/torrents/groups` folds
 * the local catalogue: one row per film, per series, per game, per book, with
 * the ways it has been cut advertised on the row.
 *
 * The partners' catalogue as a place of its own: browse it by peer, see what
 * one partner holds, follow an uploader over there. The MERGED view — their
 * releases folded into ours, one row per work with several places to get each
 * release — is `/api/torrents/groups`, and it is what a member sees by
 * default. This page is what remains useful once merging exists: a question
 * about a partner rather than a question about a work.
 *
 * Like every federated view: a release links back to its origin instance. We
 * never serve a partner's `.torrent` with the local passkey.
 */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { GROUP_SCOPES, type GroupScope } from '~~/utils/torrentGroups';
import { listRemoteGroups } from '~~/utils/remoteGroups';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(25),
  search: z.string().trim().max(200).optional(),
  peer: z.string().uuid().optional(),
  scope: z.enum(GROUP_SCOPES as unknown as [string, ...string[]]).optional(),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const query = await getValidatedQuery(event, querySchema.parse);

  // Re-read from the row so the toggle takes effect on the next page rather
  // than at the next login — same contract as the local listing.
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { showAdultContent: true },
  });

  const { groups, total } = await listRemoteGroups({
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    showAdult: !!me?.showAdultContent,
    search: query.search,
    peerId: query.peer ?? null,
    scope: query.scope as GroupScope | undefined,
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
