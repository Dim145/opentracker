/**
 * POST /api/torrents/unregistered   { infoHashes: string[] }
 *
 * Given a list of infohashes from a client, say which of them this tracker
 * still serves — and for the ones it does not, why.
 *
 * The question a member's torrent client cannot answer on its own. A client
 * holding four hundred torrents across six trackers has no way to tell an
 * announce failing because the tracker is down from one failing because the
 * release was deleted, so the usual answer is to leave dead entries in place
 * forever. This is one request that sorts them.
 *
 * It is also the natural entry point for automated cross-seeding: a script
 * that knows which of its local torrents this site does NOT have is a script
 * that knows what to upload.
 *
 * ## Verdicts
 *
 * | verdict | meaning |
 * | --- | --- |
 * | `active` | served; announces should work |
 * | `superseded` | served, but a better release replaced it — the replacement's hash comes with it |
 * | `pending` | uploaded here and not through moderation yet |
 * | `unregistered` | this tracker has no such torrent |
 *
 * `rejected` and inactive rows deliberately answer `unregistered`. The detail
 * endpoint and the duplicate preflight both refuse to confirm that a rejected
 * hash exists — it would turn either into an oracle for enumerating what
 * moderation turned down — and an endpoint that takes 256 hashes at a time is
 * the last place to open that door.
 *
 * ## Bounded
 *
 * 256 hashes per request. A client with more asks twice; the cap is what keeps
 * one request from becoming a table scan with a list of arguments.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireReadAccess } from '~~/utils/account/readKeyAuth';
import { adultCategoryIds } from '~~/utils/adultContent';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { redis } from '~~/utils/server';
import { validateBody } from '~~/utils/schemas';

const MAX_HASHES = 256;

const bodySchema = z.object({
  infoHashes: z
    .array(z.string().regex(/^[a-fA-F0-9]{40}$/))
    .min(1)
    .max(MAX_HASHES),
});

export default defineEventHandler(async (event) => {
  // Session or key: this is meant to be called by a script as much as by a
  // browser, and a script has no cookie.
  const { user: holder } = await requireReadAccess(event, 'api');
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);
  /**
   * A budget in HASHES, per account and per day.
   *
   * The rate limiter counts requests and keys on the IP, so 10 requests a minute
   * × 256 hashes is 3.7 million probes a day from one address — and a member on
   * a /64 or a VPN multiplies that freely. Counting hashes against the account
   * is what makes the cap mean something: 20 000 a day is far more than a
   * client with a few thousand torrents needs, and far less than a catalogue
   * enumeration.
   */
  const budgetKey = `unregistered:budget:${holder.id}:${new Date()
    .toISOString()
    .slice(0, 10)}`;
  const DAILY_HASH_BUDGET = 20_000;
  let spent = 0;
  try {
    spent = await redis.incrby(budgetKey, body.infoHashes.length);
    // 48 h so a key written just before midnight still expires on its own.
    if (spent === body.infoHashes.length) await redis.expire(budgetKey, 172_800);
  } catch {
    // Redis down: the request goes through. This is an abuse budget, not an
    // authorisation, and the rate limiter is still in front of it.
    spent = 0;
  }
  if (spent > DAILY_HASH_BUDGET) {
    throw createError({
      statusCode: 429,
      message: `You have checked ${DAILY_HASH_BUDGET} hashes today. The budget resets at midnight UTC.`,
    });
  }

  // De-duplicated and lowercased once, so a caller sending the same hash twice
  // does not pay for it twice.
  const wanted = [...new Set(body.infoHashes.map((h) => h.toLowerCase()))];

  const rows = await db.query.torrents.findMany({
    where: inArray(schema.torrents.infoHash, wanted),
    columns: {
      id: true,
      infoHash: true,
      isActive: true,
      moderationStatus: true,
      supersededById: true,
      categoryId: true,
    },
  });

  // The replacements' hashes, in one extra query rather than one per row.
  const replacementIds = [
    ...new Set(rows.map((r) => r.supersededById).filter((v): v is string => !!v)),
  ];
  /**
   * The replacement is only named when it is itself visible to this caller.
   *
   * The comment below said this and the query did not: a moderator marks A
   * superseded by B while B is accepted, B is later rejected or deactivated, and
   * nothing clears the pointer — so this endpoint handed out the hash AND the
   * name of a release moderation had turned down. On the endpoint whose own
   * docstring calls itself the last place to open that door.
   *
   * The adult tree goes the same way: a release the caller has not opted into is
   * not a release this may name.
   */
  const adultIds = holder.showAdultContent ? [] : await adultCategoryIds();
  const replacements = replacementIds.length
    ? await db.query.torrents.findMany({
        where: and(
          inArray(schema.torrents.id, replacementIds),
          eq(schema.torrents.isActive, true),
          eq(schema.torrents.moderationStatus, 'accepted'),
          ...(adultIds.length
            ? [
                sql`(${schema.torrents.categoryId} is null or ${schema.torrents.categoryId} not in ${adultIds})`,
              ]
            : [])
        ),
        columns: { id: true, infoHash: true, name: true },
      })
    : [];
  const replacementById = new Map(replacements.map((r) => [r.id, r]));

  const byHash = new Map(rows.map((r) => [r.infoHash, r]));

  const results = wanted.map((infoHash) => {
    const row = byHash.get(infoHash);
    if (!row || !row.isActive || row.moderationStatus === 'rejected') {
      return { infoHash, verdict: 'unregistered' as const };
    }
    // A release in the adult tree does not exist for a caller who has not opted
    // in — the same answer the catalogue, the feeds and search give.
    if (row.categoryId && adultIds.includes(row.categoryId)) {
      return { infoHash, verdict: 'unregistered' as const };
    }
    if (row.moderationStatus !== 'accepted') {
      return { infoHash, verdict: 'pending' as const };
    }
    if (row.supersededById) {
      const rep = replacementById.get(row.supersededById);
      return {
        infoHash,
        verdict: 'superseded' as const,
        // Absent when the replacement is not itself visible — the verdict is
        // still true and still useful without it.
        supersededBy: rep ? { infoHash: rep.infoHash, name: rep.name } : null,
      };
    }
    return { infoHash, verdict: 'active' as const };
  });

  return {
    checked: results.length,
    limit: MAX_HASHES,
    results,
  };
});
