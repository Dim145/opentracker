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
 *
 * Ils n'obtiennent PAS la liste des contributeurs.
 *
 * L'appel anonyme était prévu — pour `userContribution` — et
 * `topContributors` est parti avec, sans que personne y pense.
 * Mesuré sur la pile compilée : un appelant sans session recevait
 * cinq pseudonymes, leurs totaux, et surtout leurs identifiants
 * INTERNES, ceux qui servent de clé dans tout le reste de l'API.
 * Sur un tracker privé, la liste des membres est précisément ce qui
 * ne doit pas sortir.
 *
 * Personne d'authentifié n'y perd : le seul consommateur est
 * `components/shop/FreeleechPool.vue`, et `/shop` demande une
 * session. L'identifiant n'y sert d'ailleurs que de clé de boucle.
 */
import { getPublicState } from '~~/utils/freeleechPool';

export default defineEventHandler(async (event) => {
  const session = await getUserSession(event);
  const userId = session?.user?.id ?? null;
  const state = await getPublicState(userId);
  if (!userId) {
    return { ...state, topContributors: [] };
  }
  return state;
});
