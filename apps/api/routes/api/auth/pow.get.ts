/**
 * GET /api/auth/pow
 * Generate a Proof of Work challenge for registration
 */
import { generatePoWChallenge } from '~~/utils/pow';
import { rateLimit } from '~~/utils/rateLimit';

/**
 * Le même raisonnement que `challenge.get.ts`, appliqué à la même forme.
 *
 * Cette route était ouverte à l'internet, sans garde ET sans limite propre, et
 * chaque appel écrit une clé Redis `pow:<64 hex>` avec un TTL de cinq minutes.
 * Le seul plafond était `detectDDoS` — 100 requêtes par 10 s et par IP, soit
 * environ 600 clés par minute et par adresse, et 3 000 clés vivantes en
 * permanence. Un botnet, ou simplement une rotation dans un /64 IPv6, y
 * maintient des millions de clés.
 *
 * Ce que cela coûte n'est pas la mémoire en soi : ce Redis porte aussi les
 * sessions, les seaux de limitation, le cache de bannissement et le cache de
 * rôles. Sous `allkeys-lru`, l'éviction commence par ces caches — la
 * vérification de bannissement et les limites de débit se dégradent alors EN
 * SILENCE en retombant sur Postgres, ce qui convertit une pression mémoire en
 * amplification de base de données.
 *
 * Plus généreux que `RATE_LIMITS.auth` : un défi n'est pas une tentative, et un
 * client légitime en demande un par écran d'inscription.
 */
const POW_LIMIT = {
  windowSec: 300,
  maxRequests: 20,
  prefix: 'pow',
  progressive: true,
} as const;

export default defineEventHandler(async (event) => {
  await rateLimit(event, POW_LIMIT);
  const challenge = await generatePoWChallenge();
  return challenge;
});
