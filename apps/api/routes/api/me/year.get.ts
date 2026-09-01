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
  return memberYear(user.id, year);
});
