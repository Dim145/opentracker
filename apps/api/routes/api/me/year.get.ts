/**
 * GET /api/me/year?year=YYYY
 *
 * The caller's own year. Nobody else's, ever — there is no id parameter and no
 * staff override, because there is no question a moderator has that this page
 * answers better than the existing tools.
 *
 * Their data, so nothing is redacted: the adult filter is not applied here, and
 * that is deliberate rather than an omission. A member who grabbed something
 * already saw it, and a review that hid part of their own year would be a
 * report about somebody else.
 *
 * Not cached. It is one member's row set, it is cheap, and a member reading
 * their own review a second time after uploading something should see the
 * upload.
 */
import { z } from 'zod/v4';
import { eq } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateQuery } from '~~/utils/schemas';
import { memberYear } from '~~/utils/publicStats';

const querySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);
  const { year } = validateQuery(event, querySchema);

  /**
   * `hide_download_history` is a door, not a content filter.
   *
   * `/api/me/downloads` refuses the list to the AUTHENTICATED CALLER when the
   * flag is set, and says why: what the toggle buys is that a stolen session
   * cannot enumerate the snatch list. Three of the figures here come from the
   * same table on the same precondition — a year of downloaded bytes and a grab
   * count are exactly what that door is shut against — so the flag has to be
   * honoured here too. The upload side comes from `torrents` and stays.
   */
  const me = await db.query.users.findFirst({
    where: eq(schema.users.id, user.id),
    columns: { hideDownloadHistory: true },
  });

  const summary = await memberYear(user.id, year);
  if (!me?.hideDownloadHistory) return { ...summary, downloadsHidden: false };

  return {
    ...summary,
    snatches: 0,
    seedTimeSeconds: 0,
    bytesUp: 0,
    bytesDown: 0,
    downloadsHidden: true,
  };
});
