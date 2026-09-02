/**
 * Security Middleware
 * Centralized security validation for all incoming requests
 * Implements request validation, suspicious activity detection, and security headers
 */

import { detectDDoS, isBlacklisted, getClientIP } from '~~/utils/rateLimit';
import { eq } from 'drizzle-orm';
import { db } from '@trackarr/db';
import { users, webauthnCredentials } from '@trackarr/db/schema';
import {
  readBanStatusCached,
  readIpBanCached,
} from '~~/utils/adminAuth';
import { readLiveRoles } from '~~/utils/liveRoles';
import { isUserRequiredFor2FA } from '~~/utils/settings';

// ============================================================================
// Security Configuration
// ============================================================================

// The previous `SUSPICIOUS_PATTERNS` WAF regex used to match every
// request against a hand-rolled SQL-injection / XSS / path-traversal
// blocklist. It produced false positives on legitimate inputs (forum
// posts about SQL training, search queries like "drop table", torrent
// titles containing `<script` tags as scene flags, …) without adding
// any defence in depth: routes use Drizzle parameterised queries +
// Zod schemas end-to-end, and the v-html sinks on the FE go through
// DOMPurify. Path traversal stays gated by `isValidPath` below.
//
// Keeping the user-agent blocklist — that's still a cheap, low-noise
// filter against known automated scanners (sqlmap, nikto, masscan).

const BLOCKED_USER_AGENTS = [
  'sqlmap',
  'nikto',
  'masscan',
  'nmap',
  'zgrab',
  'dirbuster',
  'gobuster',
  'wfuzz',
  'hydra',
];

// ============================================================================
// Request Validation
// ============================================================================

/**
 * Check for blocked user agents
 */
function hasBlockedUserAgent(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BLOCKED_USER_AGENTS.some((blocked) => ua.includes(blocked));
}

/**
 * Validate request path
 */
function isValidPath(path: string): boolean {
  // Block path traversal attempts
  if (path.includes('..')) return false;
  if (path.includes('//')) return false;

  // Block sensitive paths
  const blockedPaths = [
    '/etc/',
    '/proc/',
    '/sys/',
    '/.env',
    '/.git',
    '/wp-admin',
    '/phpmyadmin',
    '/admin.php',
  ];

  return !blockedPaths.some((blocked) => path.toLowerCase().includes(blocked));
}

/**
 * Validate query parameters — only the size cap remains. Type-safe
 * routes use Zod / Drizzle so injection-shape strings reaching a SQL
 * query are already neutralised; rejecting them here was just a
 * false-positive magnet against innocent inputs.
 */
function validateQueryParams(query: Record<string, unknown>): boolean {
  for (const [, value] of Object.entries(query)) {
    if (typeof value === 'string') {
      if (value.length > 10000) return false; // Prevent oversized params
    }
  }
  return true;
}

// ============================================================================
// Security Headers
// ============================================================================

/**
 * Apply security headers to response
 */
function applySecurityHeaders(event: any): void {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    // `X-XSS-Protection: 1; mode=block` is deliberately NOT sent. The
    // header is deprecated and its auditor introduced its own
    // vulnerabilities (Chrome removed the feature for that reason); `0` is
    // the value modern guidance recommends. The Caddyfile already dropped
    // it — this layer had not followed.
    'X-XSS-Protection': '0',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-DNS-Prefetch-Control': 'off',
    /*
     * La CSP des réponses de l'API — et rien d'autre.
     *
     * Elle portait `script-src 'self' 'unsafe-inline'` et `style-src 'self'
     * 'unsafe-inline'`, justifiés par « Nuxt requires unsafe-inline for HMR »
     * et « Tailwind requires unsafe-inline ». Ces deux motifs appartiennent à
     * l'application WEB, qui a sa propre politique à nonce dans
     * `apps/web/server/plugins/csp.ts` ; ce processus-ci ne sert ni page, ni
     * script, ni feuille de style — uniquement du JSON, du XML (Torznab, RSS),
     * du CSS de thème et des objets stockés.
     *
     * `default-src 'none'` est donc la valeur juste : aucune réponse de l'API
     * n'a de raison d'exécuter quoi que ce soit. Cela compte pour le cas où un
     * navigateur arrive DIRECTEMENT sur une réponse — un SVG déposé dans
     * `/uploads/`, par exemple, dont le script est déjà neutralisé par
     * `servedObjectHeaders` et qui gagne ici une seconde barrière. Pour une
     * ressource chargée depuis une page (une image, la feuille de thème), c'est
     * la politique de la PAGE qui décide, pas celle-ci : la resserrer ne casse
     * donc rien.
     */
    'Content-Security-Policy': [
      "default-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  };

  // Add HSTS in production
  if (process.env.NODE_ENV === 'production') {
    headers['Strict-Transport-Security'] =
      'max-age=31536000; includeSubDomains; preload';
  }

  for (const [key, value] of Object.entries(headers)) {
    setHeader(event, key, value);
  }
}

// ============================================================================
// Main Security Middleware
// ============================================================================

export default defineEventHandler(async (event) => {
  const path = event.path || '';
  const method = event.method;

  // Skip security checks for static assets
  if (path.startsWith('/_nuxt/') || path.startsWith('/favicon')) {
    return;
  }

  // Apply security headers
  applySecurityHeaders(event);

  // Get client info
  const ip = getClientIP(event);
  const userAgent = getHeader(event, 'user-agent') || '';

  // Order matters. Everything below is sorted by cost, cheapest first, so a
  // flood is dropped as early as possible:
  //
  //   in-process checks  →  Redis  →  Postgres
  //
  // The IP-ban `SELECT` used to sit at the very top, ahead of the rate
  // limiter: an unauthenticated request cost a Postgres round trip through
  // pgbouncer before any defence could fire, which turns a packet flood into
  // a database flood. It is now cached in Redis and runs last.

  // 1. In-process filters — no I/O at all.
  if (hasBlockedUserAgent(userAgent)) {
    console.warn(
      `[Security] Blocked suspicious user agent: ${userAgent.slice(0, 50)}...`
    );
    throw createError({ statusCode: 403, message: 'Access denied' });
  }

  if (!isValidPath(path)) {
    console.warn(`[Security] Blocked suspicious path: ${path}`);
    throw createError({ statusCode: 400, message: 'Invalid request' });
  }

  if (path.startsWith('/api/')) {
    const query = getQuery(event) as Record<string, unknown>;
    if (!validateQueryParams(query)) {
      console.warn(`[Security] Blocked suspicious query params on ${path}`);
      throw createError({
        statusCode: 400,
        message: 'Invalid request parameters',
      });
    }
  }

  // 2. Redis — temporary blacklist, then the abuse counter itself.
  if (await isBlacklisted(ip)) {
    console.warn(`[Security] Blocked blacklisted IP: ${ip.slice(0, 8)}...`);
    throw createError({ statusCode: 403, message: 'Access denied' });
  }

  if (
    path.startsWith('/api/') ||
    path.includes('/announce') ||
    path.includes('/scrape')
  ) {
    await detectDDoS(event);
  }

  // 3. Persistent IP bans — Redis-cached, so this is a GET on the hot path
  //    and only reaches Postgres once a minute per distinct address.
  const ipBanReason = await readIpBanCached(ip);
  if (ipBanReason) {
    /*
     * Une issue de secours pour le personnel authentifié.
     *
     * Cette porte précède la lecture de session, et `admin/users/[id]/ban.post`
     * insère INCONDITIONNELLEMENT le `lastIp` de la cible dans `banned_ips`. Un
     * modérateur qui bannit un membre partageant une sortie CGNAT ou VPN avec
     * l'administrateur verrouillait donc l'administrateur — hors de TOUTE route
     * `/api/`, y compris `DELETE /api/admin/banned-ips/[ip]`, la seule qui
     * lèverait le blocage. Le rétablissement demandait un accès direct à la
     * base. La limitation de débit progressive pouvait produire le même
     * verrouillage sans acteur hostile.
     *
     * Le rôle est relu dans la base (cache de 60 s), pas dans le cookie : un
     * membre ordinaire ne s'échappe pas en se disant administrateur.
     */
    const banned = await getUserSession(event);
    const live = banned.user ? await readLiveRoles(banned.user.id) : null;
    if (!live?.isAdmin && !live?.isModerator) {
      throw createError({
        statusCode: 403,
        message: `Access denied: ${ipBanReason}`,
      });
    }
    console.warn(
      `[Security] IP ban bypassed for staff ${banned.user?.id}: ${ipBanReason}`
    );
  }

  // 4. Authenticated caller — ban status and mandatory-2FA policy.
  // Skip for auth routes and Torznab (which carries its own passkey auth).
  if (!path.startsWith('/api/auth/') && !path.startsWith('/api/torznab')) {
    const session = await getUserSession(event);

    if (session.user) {
      // Both reads are Redis-cached (60 s) in adminAuth. This block used to
      // issue an uncached `SELECT` on `users` for every authenticated
      // request, duplicating the cached check `requireAuthSession` performs
      // moments later.
      const status = await readBanStatusCached(session.user.id);

      if (status !== 'ok') {
        // `gone` (the row no longer exists) is treated exactly like `banned`.
        // The previous code only tested `isBanned`, then set `authChecked`
        // unconditionally — which made `requireAuthSession` skip its own
        // check and left a deleted account with a working session for the
        // remaining cookie lifetime.
        await clearUserSession(event);
        if (path.startsWith('/api/')) {
          throw createError({
            statusCode: 403,
            message:
              status === 'banned'
                ? 'Your account has been banned'
                : 'Your account no longer exists',
          });
        }
        // Non-API path: session cleared, nothing more to enforce. Do NOT
        // mark the request as checked.
        return;
      }

      // Mandatory-2FA enforcement (finding M2). require2FAScope was only
      // surfaced as a FE redirect hint, so an HTTP client could ignore it
      // and use the API with a password-only session. Enforce it here:
      // when the policy applies to this user and they have no second
      // factor, block every API route except the 2FA-enrolment endpoints
      // (and /api/auth/*, already excluded above) until they enrol. SSR
      // page loads are left alone so the FE can still render the redirect.
      // isUserRequiredFor2FA short-circuits to false when scope='off'
      // (the cached default), so this costs nothing on most deployments.
      if (path.startsWith('/api/') && !path.startsWith('/api/me/2fa/')) {
        const roles = await readLiveRoles(session.user.id);
        const required = roles
          ? await isUserRequiredFor2FA({
              isAdmin: roles.isAdmin,
              isModerator: roles.isModerator,
            })
          : false;
        if (required) {
          // Only now does the policy justify touching the DB for the
          // enrolment state.
          const [row] = await db
            .select({ totpEnabled: users.totpEnabled })
            .from(users)
            .where(eq(users.id, session.user.id))
            .limit(1);
          let has2FA = row?.totpEnabled ?? false;
          if (!has2FA) {
            const passkeyCount = await db
              .select({ id: webauthnCredentials.id })
              .from(webauthnCredentials)
              .where(eq(webauthnCredentials.userId, session.user.id))
              .then((r) => r.length);
            has2FA = passkeyCount > 0;
          }
          if (!has2FA) {
            throw createError({
              statusCode: 403,
              message:
                'Two-factor authentication is required. Enrol a second factor to continue.',
              data: { requires2FASetup: true },
            });
          }
        }
      }

      // Mark as checked to avoid a redundant lookup in requireAuthSession.
      // Only reached when the account exists and is not banned.
      event.context.authChecked = true;
    }
  }
});
