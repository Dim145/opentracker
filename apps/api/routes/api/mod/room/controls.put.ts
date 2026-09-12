/**
 * PUT /api/mod/room/controls — les deux leviers d'urgence du salon.
 *
 * Un modérateur pouvait couper la parole à quelqu'un (`mod/room/mutes`) et
 * épingler un message (`mod/room/pin`). Il ne pouvait pas agir sur le salon
 * LUI-MÊME : dix membres qui se coupent la parole, ou quelque chose qui doit
 * cesser d'être publié tout de suite, se règlent avec le ralentisseur ou la
 * portée — et ces deux réglages ne vivaient que dans
 * `PUT /api/admin/settings`, derrière `requireAdminSession`.
 *
 * Il fallait donc réveiller un administrateur pour le geste le plus urgent et
 * le plus banal de la modération d'un chat. Ces deux leviers sont ici, gardés
 * modérateur.
 *
 * Ce qui reste chez l'administration : tout le RESTE de `/api/admin/settings`.
 * Cette route n'ouvre pas la porte des réglages, elle en extrait deux boutons
 * — et refuse tout ce qui n'est pas l'un des deux.
 *
 * Les deux valeurs restent les mêmes lignes de `settings` : un administrateur
 * qui ouvre sa page voit ce qu'un modérateur a posé, et peut le défaire.
 */
import { z } from 'zod';
import { requireModeratorSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody } from '~~/utils/schemas';
import {
  getMessagingRoomScope,
  getRoomSlowModeSeconds,
  setMessagingRoomScope,
  setRoomSlowModeSeconds,
} from '~~/utils/settings';

/**
 * Les paliers du ralentisseur.
 *
 * Une liste fermée plutôt qu'un entier libre : « combien de secondes » n'est
 * pas une question qu'on pose au milieu d'une bagarre, et un champ numérique
 * invite à taper 3600 par erreur. Zéro éteint le ralentisseur.
 */
const SLOW_STEPS = [0, 5, 15, 30, 60, 300] as const;

const bodySchema = z
  .object({
    slowModeSeconds: z
      .number()
      .int()
      .refine(
        (n) => (SLOW_STEPS as readonly number[]).includes(n),
        `Slow mode must be one of ${SLOW_STEPS.join(', ')} seconds`
      )
      .optional(),
    // `off` ferme le salon, `staff` le réserve au personnel, `all` le rouvre.
    // C'est le même réglage que la page d'administration : un modérateur qui
    // ferme n'invente pas un état que l'administrateur ne saurait pas lire.
    scope: z.enum(['off', 'staff', 'all']).optional(),
  })
  // Un corps vide ne veut rien dire, et laisser passer un no-op écrirait une
  // ligne d'audit sans changement.
  .refine(
    (b) => b.slowModeSeconds !== undefined || b.scope !== undefined,
    'Nothing to change'
  );

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  await rateLimit(event, RATE_LIMITS.mutation);
  const body = await validateBody(event, bodySchema);

  if (body.slowModeSeconds !== undefined) {
    await setRoomSlowModeSeconds(body.slowModeSeconds);
  }
  if (body.scope !== undefined) {
    await setMessagingRoomScope(body.scope);
  }

  // On relit plutôt que d'écho­er l'entrée : le réglage passe par un cache, et
  // l'interface doit afficher ce qui est RÉELLEMENT en vigueur.
  const [slowModeSeconds, scope] = await Promise.all([
    getRoomSlowModeSeconds(),
    getMessagingRoomScope(),
  ]);
  return { ok: true, slowModeSeconds, scope };
});
