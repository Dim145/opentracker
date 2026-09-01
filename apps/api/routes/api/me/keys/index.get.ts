/**
 * GET /api/me/keys
 *
 * The member's three keys, and what each one opens.
 *
 * The two read keys are minted on first read — a member who never opens this
 * page never has one, which is one fewer live secret per account that has no
 * use for it.
 *
 * The announce passkey is NOT minted here and not returned here: it has its own
 * endpoint and its own reveal-and-rotate flow on `/me`, and duplicating it
 * would give the page two places to rotate the same secret. What this returns
 * about it is whether it still works on the read surfaces, so the page can say
 * so.
 */
import { requireAuthSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { ensureKey } from '~~/utils/account/readKeys';
import { isLegacyPasskeyReadAllowed } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.public);

  const [rssKey, apiKey, legacyPasskeyAccepted] = await Promise.all([
    ensureKey(user.id, 'rss'),
    ensureKey(user.id, 'api'),
    isLegacyPasskeyReadAllowed(),
  ]);

  return { rssKey, apiKey, legacyPasskeyAccepted };
});
