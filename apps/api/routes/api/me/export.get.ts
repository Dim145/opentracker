/**
 * GET /api/me/export — a copy of everything this instance holds about you.
 *
 * The GDPR right of access (Art. 15) and the right to data portability
 * (Art. 20). Erasure (Art. 17) has been here since `DELETE /api/me`; this is
 * the half that was missing, and the odd half to be missing — the difficult
 * work of deciding what counts as personal data was already done for the
 * erasure, and thirteen `/api/me/*` routes were already reading most of it a
 * page at a time. What did not exist was one request that returns the record
 * as a record.
 *
 * ## Guards
 *
 * Two, and the second is the one that matters:
 *
 *   - a live, non-banned session (the standard gate), and
 *   - a *fresh* login, exactly like account erasure. This endpoint answers
 *     with a person's entire history in one response, which makes it the most
 *     valuable single request on the site to a borrowed session. A step-up
 *     costs the legitimate member one password prompt.
 *
 * Rate-limited on the mutation bucket rather than the read bucket, despite
 * being a GET: it reads twenty-odd tables and its cost is nothing like that of
 * a page fetch.
 *
 * ## Response
 *
 * `application/json` with `Content-Disposition: attachment`, so a browser
 * saves it instead of rendering a wall of text. Deliberately NOT streamed and
 * NOT paginated — a portability export that arrives in pages is a dataset the
 * member has to reassemble, and every collection inside is capped and declares
 * its own total (see `utils/account/exportAccount`).
 *
 * `Cache-Control: no-store`, and `Vary` is irrelevant here: this must never be
 * held by a shared cache or replayed from a browser's back-forward cache.
 */
import { exportAccount } from '~~/utils/account/exportAccount';
import { requireAuthSession, requireFreshAuth } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';

/**
 * `trackarr-export-alice-2026-08-31.json`.
 *
 * The username is sanitised even though the rules already constrain it: this
 * value lands in a response header, and a newline or a quote in a filename is
 * how header injection starts. Anything outside the safe set becomes `-`.
 */
function filenameFor(username: string): string {
  const safe = username.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64) || 'account';
  const day = new Date().toISOString().slice(0, 10);
  return `trackarr-export-${safe}-${day}.json`;
}

export default defineEventHandler(async (event) => {
  const { user } = await requireAuthSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  await requireFreshAuth(event);

  const payload = await exportAccount(user.id);
  if (!payload) {
    throw createError({ statusCode: 404, message: 'Account not found' });
  }

  // Two-space indent. It doubles the byte count and it is the difference
  // between a file a person can read and one they have to run through a
  // formatter first — which is the whole point of a right of access.
  const body = JSON.stringify(payload, null, 2);

  setHeader(event, 'Content-Type', 'application/json; charset=utf-8');
  setHeader(
    event,
    'Content-Disposition',
    `attachment; filename="${filenameFor(user.username)}"`
  );
  setHeader(event, 'Cache-Control', 'no-store, max-age=0');
  return body;
});
