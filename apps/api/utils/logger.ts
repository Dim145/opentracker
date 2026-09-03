import pino from 'pino';
import { isIP } from 'net';
import { fingerprintIP } from './crypto';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),

  // Redact sensitive information from logs
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-admin-key"]',
      'req.headers.cookie',
      'password',
      'passwordHash',
      'passkey',
      '*.password',
      '*.passwordHash',
      '*.passkey',
      'REDIS_PASSWORD',
      'DB_PASSWORD',
      'NUXT_SESSION_SECRET',
      'ADMIN_API_KEY',
      'IP_HASH_SECRET',
    ],
    censor: '[REDACTED]',
  },

  // Custom serializers for common objects
  serializers: {
    req: (req: any) => ({
      method: req.method,
      url: req.url,
      // Hash IP for privacy with the same secret-keyed fingerprint used
      // elsewhere — the previous helper produced 32 unsalted bits, which
      // is trivially reversible against the IPv4 space.
      ip: hashRequestIp(req),
      userAgent: req.headers?.['user-agent'],
      referer: req.headers?.referer,
    }),
    res: (res: any) => ({
      statusCode: res.statusCode,
    }),
    err: pino.stdSerializers.err,
    user: (user: any) => ({
      id: user.id,
      username: user.username,
      isAdmin: user.isAdmin,
      // Exclude sensitive fields
    }),
  },

  // Pretty print in development
  transport: !isProd
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,

  // Production settings
  formatters: isProd
    ? {
        level: (label: string) => {
          return { level: label };
        },
      }
    : undefined,

  timestamp: pino.stdTimeFunctions.isoTime,
});

function hashRequestIp(req: any): string {
  // Only consult x-forwarded-for when we actually sit behind a trusted
  // proxy. On a directly-exposed deployment the header is attacker-
  // supplied, so honouring it unconditionally let a client forge the IP
  // fingerprint recorded in the security/audit logs (finding H2). When
  // TRUST_PROXY is off we fingerprint the real socket peer instead.
  const fwd =
    process.env.TRUST_PROXY === 'true'
      ? req.headers?.['x-forwarded-for']
      : undefined;
  /*
   * Le jeton le plus à DROITE, et validé comme une adresse.
   *
   * Le commentaire disait « only the leftmost entry is the original client ».
   * C'est vrai d'un proxy qui REMPLACE l'en-tête, et faux de tous ceux qui y
   * AJOUTENT — nginx `proxy_add_x_forwarded_for`, Traefik, HAProxy, la plupart
   * des CDN. Derrière l'un de ceux-là, avec `TRUST_PROXY=true`, le client
   * choisissait l'empreinte IP inscrite dans chaque ligne de journal de
   * sécurité, et pouvait aussi en fabriquer à partir de chaînes qui ne sont pas
   * des adresses.
   *
   * `rateLimit.ts` a reçu ce correctif (`firstValidIp`, droite→gauche +
   * `net.isIP`) et le compte-rendu de sécurité le marque comme réglé ; ce
   * fichier n'en faisait pas partie. Même parcours, même validation, ici aussi.
   */
  const rightmostValid = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const parts = value.split(',');
    for (let i = parts.length - 1; i >= 0; i--) {
      const candidate = parts[i]!.trim();
      if (candidate && isIP(candidate)) return candidate;
    }
    return null;
  };
  const raw = rightmostValid(fwd) || req.socket?.remoteAddress || null;
  if (!raw) return 'unknown';
  try {
    return fingerprintIP(raw);
  } catch {
    // fingerprintIP throws if IP_HASH_SECRET isn't configured. Avoid
    // crashing the logger for a missing secret — better to drop privacy
    // than the request log.
    return 'unhashed';
  }
}

// Create child loggers for different components
export function createLogger(name: string) {
  return logger.child({ component: name });
}

// Export specific loggers for common components
export const trackerLogger = createLogger('tracker');
export const authLogger = createLogger('auth');
export const apiLogger = createLogger('api');
export const redisLogger = createLogger('redis');
export const dbLogger = createLogger('database');
export const securityLogger = createLogger('security');
