/**
 * Do the migrations still match schema.ts?
 *
 * The gate against the drift this repo already lived through: `drizzle-kit
 * push` maintained the real schema for most of the project, the migration files
 * fell 24 tables, 37 columns and 9 indexes behind, and nothing noticed because
 * nothing compared them. A migration chain nobody runs is not a migration
 * chain.
 *
 * Two checks, both cheap:
 *
 *   1. `drizzle-kit generate` must produce nothing. It diffs schema.ts against
 *      the snapshot chain, so an empty diff means every schema change has a
 *      migration. This is the check that fails the moment someone edits
 *      schema.ts and relies on a boot-time push to catch up.
 *
 *   2. The chain must apply to an empty database. A migration that only exists
 *      as a file is not a migration; this is what caught 14 hand-written files
 *      that had never been run by anything but a human. Skipped when no
 *      BASE_DATABASE_URL is set, so the check still works locally without a
 *      Postgres to hand.
 *
 * Deliberately not compared against `push`. Measured on drizzle-kit 0.31.10:
 * push creates tables, columns and their primary/unique keys but *no secondary
 * indexes and no foreign keys* on the tables it creates. Nine indexes schema.ts
 * declares — including the full-text ones on torrents and the partial indexes
 * the grouped catalogue rides — had therefore never existed in a
 * push-maintained database. Using push as the reference would have declared
 * that state correct.
 *
 *   node scripts/check-schema-parity.mjs
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';

const MIGRATIONS = './src/migrations';
const JOURNAL = `${MIGRATIONS}/meta/_journal.json`;

const sqlFiles = () => new Set(readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')));
const snapshots = () => new Set(readdirSync(`${MIGRATIONS}/meta`).filter((f) => f.endsWith('_snapshot.json')));

// ── 1. schema.ts must have nothing left to generate ────────────────────
const beforeSql = sqlFiles();
const beforeSnap = snapshots();
const beforeJournal = readFileSync(JOURNAL, 'utf8');

const gen = spawnSync(
  process.execPath,
  ['./node_modules/drizzle-kit/bin.cjs', 'generate', '--dialect=postgresql',
   '--schema=./src/schema.ts', `--out=${MIGRATIONS}`],
  { encoding: 'utf8', env: { ...process.env, CI: '1', NO_COLOR: '1' } }
);

const newSql = [...sqlFiles()].filter((f) => !beforeSql.has(f));
const newSnap = [...snapshots()].filter((f) => !beforeSnap.has(f));

// Put the tree back before reporting, so a failing check never leaves a
// half-written migration behind for the next run to trip over.
let generated = '';
for (const f of newSql) {
  generated = readFileSync(`${MIGRATIONS}/${f}`, 'utf8');
  rmSync(`${MIGRATIONS}/${f}`);
}
for (const f of newSnap) rmSync(`${MIGRATIONS}/meta/${f}`);
writeFileSync(JOURNAL, beforeJournal);

if (gen.status !== 0) {
  console.error('drizzle-kit generate failed:\n');
  console.error(`${gen.stdout ?? ''}${gen.stderr ?? ''}`.trim() || `exit ${gen.status}`);
  process.exit(1);
}

if (newSql.length > 0) {
  console.error(
    'schema.ts has changes with no migration.\n\n' +
      'Generate one and commit it — do not rely on a boot-time push, which\n' +
      'does not create indexes or foreign keys at all:\n' +
      '  pnpm --filter @trackarr/db exec drizzle-kit generate\n\n' +
      `What is missing (${newSql.join(', ')}):\n`
  );
  console.error(
    generated
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40)
      .map((s) => `  ${s.replace(/\s+/g, ' ').slice(0, 150)}`)
      .join('\n')
  );
  process.exit(1);
}

console.log('schema.ts and the migrations agree — generate produced nothing.');

// ── 2. The chain must apply to an empty database ───────────────────────
const BASE = process.env.BASE_DATABASE_URL;
if (!BASE) {
  console.log('BASE_DATABASE_URL not set — skipping the apply-to-empty check.');
  process.exit(0);
}

const { default: postgres } = await import('postgres');
const { drizzle } = await import('drizzle-orm/postgres-js');
const { migrate } = await import('drizzle-orm/postgres-js/migrator');

const DB = 'parity_apply';
const urlFor = (db) => {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  return u.toString();
};

const admin = postgres(BASE, { max: 1, onnotice: () => {} });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${DB}`);
  await admin.unsafe(`CREATE DATABASE ${DB}`);
} finally {
  await admin.end({ timeout: 5 });
}

const sql = postgres(urlFor(DB), { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: MIGRATIONS });
  const [{ tables }] = await sql`
    SELECT count(*)::int AS tables FROM pg_tables WHERE schemaname = 'public'`;
  const [{ columns }] = await sql`
    SELECT count(*)::int AS columns FROM information_schema.columns WHERE table_schema = 'public'`;
  const [{ indexes }] = await sql`
    SELECT count(*)::int AS indexes FROM pg_indexes WHERE schemaname = 'public'`;
  console.log(
    `The chain applies to an empty database — ${tables} tables, ${columns} columns, ${indexes} indexes.`
  );
} catch (err) {
  console.error('The migrations do not apply to an empty database:\n');
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
