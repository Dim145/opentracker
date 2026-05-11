/**
 * GET /api/upload-rules
 *
 * Authenticated-but-not-admin endpoint. The upload form fetches this
 * at mount to wire up its live validation (asterisk on required
 * fields, disabled submit button until everything is filled, regex
 * preview on the title).
 *
 * Same shape as `/api/admin/upload-rules` since the rules are not
 * sensitive — they're already advertised implicitly by the rejection
 * messages on POST /torrents. Exposing them up-front avoids the
 * pattern where a user fills a long form just to be told at submit
 * that their description was 50 chars too short.
 *
 * Identity matters for the `isStaff`-driven bypass: if the rules
 * have `staffBypass = true` and the requester is staff, every rule
 * the client sees is the snapshot with `bypassed` true — the FE
 * suppresses the asterisks accordingly.
 */
import { getUploadRules } from '~~/utils/uploadRules';

export default defineEventHandler(async (event) => {
  const { user } = await requireUserSession(event);
  const rules = await getUploadRules();
  const isStaff = !!(user.isAdmin || user.isModerator);
  const bypassed = rules.staffBypass && isStaff;
  return {
    ...rules,
    bypassed,
  };
});
