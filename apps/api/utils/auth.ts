// Admin API-key gate. The session-based path lives in adminAuth.ts; this
// file is for header-based access only (X-Admin-Key or `Authorization:
// Bearer …`). Constant-time comparison prevents key recovery via timing.
//
// AUCUNE ROUTE N'APPELLE `requireAdmin` NI `isAdmin` AUJOURD'HUI.
//
// Vérifié le 2026-09-02 : rien sous `routes/`, `middleware/` ni `plugins/`
// ne les invoque, et `x-admin-key` n'apparaît qu'ici et dans la liste de
// masquage de `logger.ts`. Le panneau d'administration s'authentifie par
// session (`requireAdminSession`, dans adminAuth.ts) — pas par cette clé.
//
// Cela mérite d'être écrit, parce que toute la plomberie autour donne
// l'impression du contraire : `ADMIN_API_KEY` figure dans `.env.example`, le
// chart Helm le génère sur 48 octets et le garde stable entre deux mises à
// jour, `docker-compose.prod.yml` le passe au conteneur, et trois pages du
// guide le présentaient comme obligatoire — dont une qui affirmait que
// l'application refuse de démarrer sans lui. C'est faux :
// `plugins/00.secrets.ts` n'exige que `NUXT_SESSION_SECRET` et
// `IP_HASH_SECRET`. Les trois pages ont été corrigées le même jour.
//
// La porte n'est pas supprimée pour autant : elle est correcte (comparaison
// à temps constant, 503 quand la clé n'est pas configurée plutôt qu'un
// passe-droit en développement), et son coût est nul tant qu'on ne l'appelle
// pas. Ce qui était nuisible, c'était la documentation qui la faisait passer
// pour une protection active.

import { randomBytes } from 'crypto';

const ADMIN_API_KEY = process.env.ADMIN_API_KEY || '';

export function generatePasskey(): string {
  return randomBytes(20).toString('hex');
}

export function requireAdmin(event: any): void {
  const apiKey =
    getHeader(event, 'x-admin-key') ||
    getHeader(event, 'authorization')?.replace('Bearer ', '');

  // No key configured → admin routes are unavailable, regardless of
  // NODE_ENV. The previous behaviour passed-through in development /
  // staging, which silently opened admin routes whenever an operator
  // forgot to set the env var (or whenever NODE_ENV happened to read
  // as `development` / `test` — e.g. on a CI box where the env was
  // never propagated). 503 is the right answer everywhere: a route
  // that requires an unconfigured credential is simply not available.
  if (!ADMIN_API_KEY) {
    throw createError({
      statusCode: 503,
      message:
        'Admin API not configured — set ADMIN_API_KEY in the environment to enable header-auth admin routes.',
    });
  }

  if (!apiKey) {
    throw createError({
      statusCode: 401,
      message: 'Authentication required',
    });
  }

  if (!secureCompare(apiKey, ADMIN_API_KEY)) {
    throw createError({
      statusCode: 403,
      message: 'Invalid credentials',
    });
  }
}

export function isAdmin(event: any): boolean {
  try {
    requireAdmin(event);
    return true;
  } catch {
    return false;
  }
}
