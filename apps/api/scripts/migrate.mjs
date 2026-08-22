// Applies the committed SQL migrations, then exits.
//
// Runs drizzle-orm's migrator rather than `drizzle-kit migrate`, for one
// measured reason: drizzle-kit 0.31.10 fails this silently. On a chain it
// cannot apply it prints the config it read, a spinner, and nothing else — a
// 262-byte log and exit code 1, with no mention of which statement broke. The
// migrator underneath it throws a real error naming the failing query, which
// is the difference between an operator fixing a deploy in a minute and
// bisecting migrations by hand.
//
// Lives in /app/db-tools/packages/db so `postgres` and `drizzle-orm` resolve
// from the tree the image already ships for schema work; the entrypoint spawns
// it with that directory as cwd, which is also what makes the relative
// migrations path below correct.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

const url = process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.error('[Migrate] no DATABASE_URL');
  process.exit(1);
}

// `max: 1` because migrations are strictly sequential and a pool would let
// drizzle open a second session mid-chain for no benefit. Notices are dropped:
// every idempotent guard in the chain emits "already exists, skipping", and a
// hundred of those bury the one line that matters.
const sql = postgres(url, { max: 1, onnotice: () => {} });

/**
 * Serialises migration across replicas.
 *
 * drizzle-orm's migrator takes no lock. It reads the newest recorded migration,
 * then applies everything after it inside one transaction — so two replicas
 * booting together both read the same starting point and both apply the same
 * chain.
 *
 * Measured, two migrators started at once against an empty database: the first
 * succeeds and the second fails outright on `CREATE TABLE IF NOT EXISTS
 * "announce_log"`. IF NOT EXISTS is not atomic against a concurrent create —
 * both transactions pass the existence check, then one loses. Idempotent DDL
 * does not help here. And because a failed migration now aborts the boot, that
 * replica crash-loops through the deploy.
 *
 * A session-level advisory lock is the standard answer and costs nothing:
 * whoever gets there first migrates, the others block, then find the work done
 * and apply nothing. Session-level rather than transaction-level is what makes
 * it safe against a replica that dies mid-migration: the connection goes, the
 * lock goes with it, and the next boot proceeds instead of waiting forever on a
 * lock nobody holds.
 *
 * The key is arbitrary but must never change: a different number is a different
 * lock, which is no lock at all.
 */
const LOCK_KEY = 49192221;

let waited = false;
{
  const [{ locked }] = await sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  if (!locked) {
    console.log('[Migrate] another instance is migrating — waiting for it');
    waited = true;
    await sql`SELECT pg_advisory_lock(${LOCK_KEY})`;
  }
}

try {
  await migrate(drizzle(sql), { migrationsFolder: './src/migrations' });
  console.log(waited ? '[Migrate] applied (after waiting)' : '[Migrate] applied');
} catch (err) {
  // The failing statement is the useful part, and it is on `err.message` for
  // postgres.js. Printed in full rather than truncated: a migration statement
  // is a few lines, and cutting it is how you end up with a log that proves a
  // failure happened without saying what failed.
  console.error('[Migrate] FAILED');
  console.error(String(err?.message ?? err));
  for (const k of ['code', 'detail', 'hint', 'where', 'schema_name', 'table_name', 'constraint_name']) {
    if (err?.[k]) console.error(`[Migrate]   ${k}: ${err[k]}`);
  }
  process.exitCode = 1;
} finally {
  // Best-effort: ending the session releases it anyway, so a failure here is
  // not worth masking the migration's own error with.
  await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
  await sql.end({ timeout: 5 });
}
