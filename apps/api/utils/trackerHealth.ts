/**
 * Le tracker est-il joignable ? Une seule réponse, pour tout le site.
 *
 * Ce module existe parce qu'il y en avait deux, et qu'elles se contredisaient
 * en public :
 *
 *   - la page d'accueil lisait `/api/tracker-health`, qui sonde réellement
 *     `http://tracker:8080/health` et dit la vérité ;
 *   - le tableau de bord d'administration lisait `/api/admin/stats`, qui
 *     renvoyait `status: 'running'` **en dur**.
 *
 * Le second n'était donc pas un état mais une décoration : il affichait
 * « en ligne » quoi qu'il arrive, y compris conteneur tracker arrêté. Un
 * indicateur qui ne peut jamais signaler de panne est pire qu'absent — c'est
 * la page vers laquelle un exploitant se tourne quand quelque chose cloche, et
 * elle le rassurait à tort. Les deux surfaces passent maintenant par ici.
 *
 * Le cache est partagé lui aussi, et c'est le point : deux caches séparés
 * pouvaient déjà se contredire pendant leurs dix secondes respectives.
 */

/** Ce que le tracker répond sur `/health` : 200 seulement si Postgres ET Redis répondent. */
export interface TrackerHealth {
  online: boolean;
  /** Millisecondes unix de la dernière sonde ; l'interface affiche « vérifié il y a Xs ». */
  checkedAt: number;
}

const CACHE_TTL_MS = 10_000;
const PROBE_TIMEOUT_MS = 1_500;

let cached: { value: TrackerHealth; expiresAt: number } | null = null;

function trackerHealthUrl(): string {
  const base =
    process.env.TRACKER_INTERNAL_URL ||
    process.env.TRACKER_HEALTH_URL ||
    'http://tracker:8080';
  return base.replace(/\/+$/, '') + '/health';
}

async function probe(): Promise<TrackerHealth> {
  const url = trackerHealthUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return { online: res.ok, checkedAt: Date.now() };
  } catch {
    // Injoignable, DNS muet, délai dépassé : de l'extérieur c'est le même fait.
    return { online: false, checkedAt: Date.now() };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * L'état, mis en cache quelques secondes — pour qu'une pointe de trafic sur la
 * page d'accueil ne se traduise pas en rafale de sondes contre le tracker.
 */
export async function readTrackerHealth(): Promise<TrackerHealth> {
  const now = Date.now();
  if (cached && cached.expiresAt > now) return cached.value;
  const value = await probe();
  cached = { value, expiresAt: now + CACHE_TTL_MS };
  return value;
}
