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
  await db.execute(
    sql`TRUNCATE TABLE
          upload_request_fill_attempts, upload_requests, invitations,
          reports, torrents, tags, categories, settings,
          freeleech_pool_cycles, freeleech_pool_contributions,
          bonus_grants, bonus_rules,
          federation_config, federation_peers,
          catalog_records,
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
