import { afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@trackarr/db';
import { redis } from '../../redis/client';

// Each test starts from an empty slate. CASCADE handles the FK order
// between users / categories / invitations / upload_requests. With
// vitest's default per-file isolation this `db` pool is unique to the
// file, so closing it in afterAll is safe (and lets the process exit
// without waiting on postgres-js idle timeouts).
beforeEach(async () => {
  // `torrents`, `tags` et `settings` s'ajoutent à la liste depuis que les
  // suites recherche / signalements / bonus écrivent dedans. CASCADE se
  // charge des tables liées (torrent_tags, bonus_grants, contributions au
  // pool), donc les nommer serait redondant — mais les OUBLIER laisserait
  // des lignes d'un test fuir dans le suivant, ce qui se manifeste par des
  // échecs qui dépendent de l'ordre d'exécution.
  await db.execute(
    sql`TRUNCATE TABLE
          upload_request_fill_attempts, upload_requests, invitations,
          reports, torrents, tags, categories, settings,
          freeleech_pool_cycles, freeleech_pool_contributions,
          bonus_grants, bonus_rules, users
        RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await closeDatabase();
  // ioredis garde une connexion ouverte et un handle actif : sans ce quit,
  // vitest reste suspendu après le dernier test au lieu de rendre la main,
  // et le run finit par être tué par le timeout du harnais.
  await redis.quit().catch(() => {});
});
