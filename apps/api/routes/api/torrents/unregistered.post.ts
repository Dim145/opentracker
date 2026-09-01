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
import { inArray } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';

const MAX_HASHES = 256;

const bodySchema = z.object({
  infoHashes: z
    .array(z.string().regex(/^[a-fA-F0-9]{40}$/))
    .min(1)
    .max(MAX_HASHES),
});

export default defineEventHandler(async (event) => {
  // A member's own read of the catalogue, so a session. A script wanting to
  // call this needs a cookie for now; per-user read keys come later on this
  // branch, and this is the first route that will want one.
  await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);

  const body = await validateBody(event, bodySchema);
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
    },
  });

  // The replacements' hashes, in one extra query rather than one per row.
  const replacementIds = [
    ...new Set(rows.map((r) => r.supersededById).filter((v): v is string => !!v)),
  ];
  const replacements = replacementIds.length
    ? await db.query.torrents.findMany({
        where: inArray(schema.torrents.id, replacementIds),
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
