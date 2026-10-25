/**
 * GET /api/rules — the site rules, as staff wrote them in Admin → Branding.
 *
 * The admin form has long described them as "displayed to users", and nothing
 * served them: they lived in the editor and nowhere else. Public, like
 * `/api/privacy`: somebody holding an invitation reads the rules before
 * deciding to register, and nothing in them is about any member. Rich text
 * from the editor, stored as HTML; the page sanitises it.
 */
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { getSiteRules } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);
  return { rules: await getSiteRules() };
});
