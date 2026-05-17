/**
 * GET /api/freeleech-pool/state — user-facing snapshot.
 *
 * Returns the config, the current cycle (or the most recent closed
 * one), the top 5 contributors, and the calling user's own total
 * for this cycle. The shop widget consumes the whole payload in
 * one shot to keep the open/closed/full transitions snappy.
 *
 * Anonymous callers get `userContribution: null` instead of zero
 * so the FE can tell "not logged in" from "logged in, didn't
 * contribute yet".
 */
import { getPublicState } from '~~/utils/freeleechPool';

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  const userId = session?.user?.id ?? null;
  const state = await getPublicState(userId);
  return state;
});
