import { afterAll, beforeAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@trackarr/db';
import { connectRedis, redis } from '../../redis/client';

/**
 * Attendre Redis AVANT le premier test, comme le fait la production.
 *
 * Le client partagé tourne en `lazyConnect: true` + `enableOfflineQueue: false`
 * (`redis/client.ts`) : sans file d'attente, une commande émise avant que la
 * socket soit prête LÈVE au lieu de patienter. La production a un garde pour
 * exactement ça — `plugins/00.redis.ts` attend `connectRedis()` avant qu'aucune
 * route ne tourne — mais la suite d'intégration n'exécute pas la chaîne de
 * plugins de Nitro. Elle importait le client et le fermait au démontage, sans
 * jamais le connecter.
 *
 * Ce qui en découlait était pire que du bruit. La première commande Redis de
 * chaque fichier échouait, tous les appelants de ces chemins attrapent et
 * journalisent — donc rien ne ratait — et la connexion s'établissait comme
 * EFFET DE BORD de l'échec. Résultat : onze occurrences dans un même job de
 * CI, et surtout des tests verts qui n'exerçaient pas ce qu'ils prétendaient.
 * `owner.itest.ts > "erasure hands the instance on"` passait alors que le
 * nettoyage Torznab de `eraseAccount` n'avait rien fait ; si
 * `retireTorznabPasskey` avait été cassé de bout en bout, il serait passé
 * quand même.
 *
 * Le commentaire de `freshAuth.itest.ts` disait que les autres suites « s'en
 * sortent parce qu'elles atteignent Redis via `getSetting`, qui connecte au
 * passage ». Elles ne s'en sortaient pas : leur erreur était seulement
 * invisible.
 *
 * Le `status` est vérifié explicitement pour que le retour du défaut soit une
 * panne bruyante au montage, et non onze lignes de stderr éparpillées que
 * personne ne relie entre elles.
 */
beforeAll(async () => {
  await connectRedis();
  if (redis.status !== 'ready') {
    throw new Error(
      `Redis n'est pas prêt (status: ${redis.status}). Les commandes vont lever ` +
        `« Stream isn't writeable » et les appelants les avaleront en silence.`,
    );
  }
});

// Each test starts from an empty slate. CASCADE handles the FK order
// between users / categories / invitations / upload_requests. With
// vitest's default per-file isolation this `db` pool is unique to the
// file, so closing it in afterAll is safe (and lets the process exit
// without waiting on postgres-js idle timeouts).
beforeEach(async () => {
  // `torrents`, `tags` and `settings` joined the list once the search /
  // reports / bonus suites started writing to them. CASCADE takes care of the
  // dependent tables (torrent_tags, bonus_grants, pool contributions), so
  // naming those would be redundant — but FORGETTING a root would let one
  // test's rows leak into the next, which shows up as failures that depend on
  // execution order.
  //
  // The federation tables are named explicitly: `peers` is the root of the
  // mirror (remote_torrents, sync_state and follows hang off it), while
  // `federation_config` references nothing and would therefore survive a
  // CASCADE from `users`.
  //
  // `catalog_records` is named for a subtler reason: its `torrent_id` is
  // deliberately NOT a foreign key, because a published record has to outlive
  // the torrent it describes. That is also what puts it out of reach of a
  // CASCADE, so records would leak between tests and every assertion about
  // "the whole stream" would count somebody else's.
  //
  // `themes` and `uploaded_fonts` are named for the same reason from the other
  // direction: their only foreign key is a nullable `SET NULL` to `users`, so a
  // CASCADE from `users` empties that column and leaves the row behind. A theme
  // surviving into the next test breaks every assertion about which themes are
  // served — and it would do so by ORDER, which is the kind of failure that
  // looks like flakiness.
  await db.execute(
    sql`TRUNCATE TABLE
          upload_request_fill_attempts, upload_requests, invitations,
          reports, torrents, tags, categories, settings,
          freeleech_pool_cycles, freeleech_pool_contributions,
          bonus_grants, bonus_rules,
          federation_config, federation_peers,
          catalog_records,
          themes, uploaded_fonts,
          users
        RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await closeDatabase();
  // ioredis keeps a connection and an active handle open: without this quit,
  // vitest hangs after the last test instead of returning, and the run ends up
  // killed by the harness timeout.
  await redis.quit().catch(() => {});
});
