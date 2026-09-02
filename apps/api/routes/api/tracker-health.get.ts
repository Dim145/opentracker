import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { readTrackerHealth } from '~~/utils/trackerHealth';

// Résumé public que lit le badge de la page d'accueil.
//
// La sonde et son cache vivent dans `utils/trackerHealth.ts`, partagés avec
// `/api/admin/stats` : les deux surfaces affichaient auparavant des états
// contradictoires, l'une sondant et l'autre non. Voir l'en-tête de ce module.
//
// On ne publie délibérément pas le détail par composant (db / redis) ici —
// c'est un diagnostic réservé à l'administration. Le badge ne veut savoir
// qu'une chose : le tracker répond-il.
export default defineEventHandler(async (event) => {
  await rateLimit(event, RATE_LIMITS.public);
  return await readTrackerHealth();
});
