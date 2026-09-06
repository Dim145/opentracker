import { redis } from '../server';
import { META_TTL, NEG_SENTINEL, UpstreamUnavailableError } from './types';

export { UpstreamUnavailableError };

/**
 * Exécute une recherche amont ; si elle échoue pour cause de PANNE (et non
 * d'absence), retient la case vide `META_TTL.ERR_S` secondes sous la même clé
 * que le résultat, et rend la valeur vide. Toute autre erreur remonte.
 *
 * C'est la seule différence entre « TMDB ne répond pas » et « TMDB ne connaît
 * pas cet identifiant » : la première se réessaie dans deux minutes, la
 * seconde dans une heure.
 */
export async function guarded<T>(cacheKey: string, empty: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof UpstreamUnavailableError)) throw err;
    try {
      await redis.setex(cacheKey, META_TTL.ERR_S, NEG_SENTINEL);
    } catch {
      /* l'écriture du cache n'est jamais fatale */
    }
    return empty;
  }
}
