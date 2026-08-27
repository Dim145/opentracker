/**
 * Tell an existing database which migrations it already contains.
 *
 * Run ONCE, before the first boot on an image that migrates instead of
 * pushing. Skipping it is not a small mistake: drizzle-orm's migrator applies
 * everything recorded after the newest row in `drizzle.__drizzle_migrations`,
 * and on a database that has never held that table "everything" means the
 * whole chain from 0000 — against a schema that already has most of it.
 *
 * The cut is a statement about the DATABASE, not about the code: which
 * migrations does this instance already contain? For anything built by the
 * boot-time `push` — which is every instance up to now — 0009 is the right
 * answer. The chain from 0009a onward is written to converge rather than to
 * assume: creates carry IF NOT EXISTS, drops carry IF EXISTS, constraints are
 * guarded. So the migrations after the cut find what is already there and add
 * only what is missing.
 *
 * Rehearsed on both databases this actually applies to:
 *
 *   · a 0.21.0 instance — 47 tables and 128 indexes became 58 and 176, with
 *     its data untouched, and the result was column-for-column and
 *     index-for-index identical to a database the chain built from empty.
 *   · an instance push had already brought to the current schema — 161 indexes
 *     became 176. Those 15 are the ones push had drifted past, among them
 *     `user_signing_keys_current`, which is not an optimisation but the only
 *     thing enforcing one live signing key per member.
 *
 *   DATABASE_URL=postgres://… node scripts/baseline.mjs
 *   DATABASE_URL=… BASELINE_THROUGH=0009_roles_moderation node scripts/baseline.mjs
 *
 * Safe to re-run: it does nothing on a database that already has rows.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';

const DIR = process.env.MIGRATIONS_DIR || './src/migrations';
const THROUGH = process.env.BASELINE_THROUGH || '0009_roles_moderation';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('[Baseline] DATABASE_URL is required');
  process.exit(1);
}

const journal = JSON.parse(readFileSync(`${DIR}/meta/_journal.json`, 'utf8'));
if (!journal.entries.some((e) => e.tag === THROUGH)) {
  console.error(`[Baseline] no migration tagged ${THROUGH} in the journal`);
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql.unsafe('CREATE SCHEMA IF NOT EXISTS drizzle');
  await sql.unsafe(`CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
    id SERIAL PRIMARY KEY,
    hash text NOT NULL,
    created_at bigint
  )`);

  // Refusing rather than merging. A database with rows has either been
  // baselined or been migrated, and adding more would move the watermark
  // forward — silently skipping migrations it has never run.
  const [{ n }] = await sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`;
  if (n > 0) {
    console.log(`[Baseline] already has ${n} rows — nothing to do`);
    process.exit(0);
  }

  let written = 0;
  for (const entry of journal.entries) {
    const body = readFileSync(`${DIR}/${entry.tag}.sql`, 'utf8');
    // The hash drizzle-orm records: sha256 over the file exactly as read. The
    // migrator decides what to apply from `created_at`, not from this — but a
    // wrong hash would make the table lie to whoever reads it next.
    const hash = createHash('sha256').update(body).digest('hex');
    await sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
              VALUES (${hash}, ${entry.when})`;
    written++;
    if (entry.tag === THROUGH) break;
  }
  console.log(`[Baseline] recorded ${written} migrations, through ${THROUGH}`);
} finally {
  await sql.end({ timeout: 5 });
}
