import { afterAll, beforeEach } from 'vitest';
import { sql } from 'drizzle-orm';
import { db, closeDatabase } from '@trackarr/db';

// Each test starts from an empty slate. CASCADE handles the FK order
// between users / categories / invitations / upload_requests. With
// vitest's default per-file isolation this `db` pool is unique to the
// file, so closing it in afterAll is safe (and lets the process exit
// without waiting on postgres-js idle timeouts).
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE TABLE upload_request_fill_attempts, upload_requests, invitations, reports, categories, users RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await closeDatabase();
});
