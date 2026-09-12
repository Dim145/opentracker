/**
 * GET /api/mod/room/controls — l'état des deux leviers.
 *
 * L'interface doit pouvoir afficher la position courante du ralentisseur et
 * de la portée sans demander la page entière des réglages, qui est fermée aux
 * modérateurs.
 */
import { requireModeratorSession } from '~~/utils/adminAuth';
import { getMessagingRoomScope, getRoomSlowModeSeconds } from '~~/utils/settings';

export default defineEventHandler(async (event) => {
  await requireModeratorSession(event);
  const [slowModeSeconds, scope] = await Promise.all([
    getRoomSlowModeSeconds(),
    getMessagingRoomScope(),
  ]);
  return { slowModeSeconds, scope };
});
