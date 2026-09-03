import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Options, type PostgresType } from 'postgres';
import * as schema from './schema';

/**
 * Secure PostgreSQL Connection Configuration
 * Supports SSL/TLS, connection pooling, and security hardening
 */

const connectionString =
  process.env.DATABASE_URL ||
  'postgres://tracker:tracker@localhost:5432/trackarr';
const isProduction = process.env.NODE_ENV === 'production';

// Build secure connection options
/**
 * Les types personnalisés que la connexion déclare.
 *
 * Le générique était `Record<string, never>` — « aucun type personnalisé » —, ce
 * qui rendait le champ `types` intypable. Il en porte un désormais : l'analyseur
 * d'OID 1114, voir plus bas.
 */
type CustomTypes = Record<'naiveTimestamp', PostgresType<Date>>;

function buildPostgresOptions(): Options<CustomTypes> {
  const options: Options<CustomTypes> = {
    // Connection pool settings
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idle_timeout: 10,
    connect_timeout: 10,

    // Query settings
    // Énoncés préparés. À NE PAS confondre avec la protection contre
    // l'injection SQL, qui vient de la LIAISON DE PARAMÈTRES et opère aussi
    // avec `prepare: false` — le commentaire d'origine l'affirmait, ce qui
    // décourageait précisément le changement qui rendrait sans objet la
    // question du pooling en mode transaction (voir
    // `doc/guide/high-availability.md`, point 4).
    prepare: true,

    // Transform settings for security
    transform: {
      undefined: null, // Prevent undefined values in queries
    },

    /*
     * `timestamp without time zone` relu en UTC, et non dans le fuseau du
     * processus.
     *
     * postgres.js 3.4 analyse les OID 1082 (date), 1114 (timestamp) et 1184
     * (timestamptz) avec le MÊME `new Date(x)`. À l'écriture il envoie un
     * `toISOString()`, et Postgres jette l'offset d'une colonne `timestamp` :
     * la valeur stockée est donc l'heure murale UTC. À la lecture, Postgres
     * renvoie `2026-07-14 16:30:00` sans offset, et V8 interprète cette forme
     * dans le fuseau LOCAL du processus.
     *
     * Le compose de production pose `TZ=Europe/Paris` sur le service d'API.
     * Mesuré dans un Postgres 18.6 jetable : un instant écrit à 16:30 UTC se
     * relit à 14:30 UTC. Deux heures d'erreur sur les 457 colonnes
     * `timestamp` du schéma — c'est-à-dire presque toutes.
     *
     * L'asymétrie est ce qui rend le défaut sournois : une comparaison faite en
     * SQL (`gt(expiresAt, new Date())`) est juste, parce que drizzle sérialise
     * en UTC et que Postgres jette l'offset des deux côtés. Seules les
     * comparaisons faites en JavaScript dérivent — `banned_until`,
     * `trusted_devices.expires_at`, `invitations.expires_at`, les échéances de
     * hit-and-run, les fenêtres de freeleech — et tout affichage de date.
     *
     * Un analyseur pour le seul OID 1114 corrige les 457 colonnes d'un coup,
     * sans migration. La bonne fin de l'histoire reste de passer le schéma en
     * `timestamptz` ; en attendant, ceci est exact et vérifiable.
     */
    types: {
      naiveTimestamp: {
        to: 1114,
        from: [1114],
        // Défensif sur le type d'entrée : drizzle envoie un `Date` pour une
        // colonne en mode date, une chaîne déjà formée en mode string.
        serialize: (x: Date | string) =>
          x instanceof Date ? x.toISOString() : String(x),
        parse: (x: string) => new Date(`${x}Z`),
      } as PostgresType<Date>,
    },

    // Connection lifecycle hooks
    onnotice: () => {}, // Suppress notice messages
  };

  // SSL/TLS configuration
  // In Docker internal networks, SSL is typically disabled (DB_SSL=false)
  // For external/cloud databases, enable SSL
  const sslDisabled = process.env.DB_SSL === 'false';
  if (!sslDisabled && (isProduction || process.env.DB_SSL === 'true')) {
    options.ssl = {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      // Custom CA certificate support
      ...(process.env.DB_SSL_CA && { ca: process.env.DB_SSL_CA }),
    };
  }

  // Debug mode (only in development)
  if (process.env.DB_DEBUG === 'true' && !isProduction) {
    options.debug = (connection, query, params) => {
      // Sanitize params to avoid logging sensitive data
      const sanitizedParams = params?.map((p) =>
        typeof p === 'string' && p.length > 20 ? `${p.slice(0, 10)}...` : p
      );
      console.log('[DB]', query.slice(0, 100), sanitizedParams);
    };
  }

  return options;
}

// Connection for queries (pooled)
const client = postgres(connectionString, buildPostgresOptions());

export const db = drizzle(client, { schema });

export { schema };

/**
 * Check database connection health
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

/**
 * Get connection pool stats (for monitoring)
 */
export function getPoolStats(): { max: number; idle_timeout: number } {
  return {
    max: parseInt(process.env.DB_POOL_MAX || '10'),
    idle_timeout: 10,
  };
}

/**
 * Graceful shutdown
 */
export async function closeDatabase(): Promise<void> {
  await client.end();
}

// The full-text expression: shared between the index declarations (schema.ts)
// and the search queries, so the two cannot diverge.
export { ftsVector, FTS_CONFIG } from './search';
// The reaction vocabulary lives with the CHECK constraint that enforces
// it, so the API and the database cannot disagree about what is valid.
export { REACTION_KEYS, type ReactionKey } from './schema';
