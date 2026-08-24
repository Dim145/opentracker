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
 *      schema.ts and expects some later step to catch the database up.
 *
 *   2. The chain must apply to an empty database. A migration that only exists
 *      as a file is not a migration; this is what caught 14 hand-written files
 *      that had never been run by anything but a human. Skipped when no
 *      BASE_DATABASE_URL is set, so the check still works locally without a
 *      Postgres to hand.
 *
 *   3. Every .sql file must be IN the journal. Neither check above can see an
 *      orphan, because both start from the journal — so a file that looks like
 *      part of the chain, is numbered like the others, and is never applied
 *      sits there indefinitely. 0006_hnr_tags_invites_reports.sql was one: a
 *      survivor of the cleanup in (2), duplicating 0006_misty_wolf_cub.sql with
 *      Postgres-default constraint names instead of drizzle's. Anyone reading
 *      the directory rather than the journal — or applying `*.sql` in a loop,
 *      which is an obvious thing to do — got 74 foreign keys where the real
 *      chain produces 66, the extra 8 being duplicates under a second name.
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
      'Generate one and commit it. The boot applies committed migrations and\n' +
      'nothing else, and push — which is not run anywhere any more — never\n' +
      'created indexes or foreign keys in the first place:\n' +
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

// ── 3. No .sql file outside the journal ────────────────────────────────
// Cheap, no database needed, and it runs before the apply check so the
// failure names the file rather than showing up as a puzzling schema diff.
const journalTags = new Set(
  JSON.parse(readFileSync(JOURNAL, 'utf8')).entries.map((e) => `${e.tag}.sql`)
);
const orphans = [...sqlFiles()].filter((f) => !journalTags.has(f)).sort();
if (orphans.length) {
  console.error(
    `${orphans.length} migration file(s) are not in _journal.json, so nothing ` +
      'ever applies them:\n'
  );
  for (const f of orphans) console.error(`  ${MIGRATIONS}/${f}`);
  console.error(
    '\nA file in this directory that is not in the journal is worse than no ' +
      'file: it reads as part of the chain and is not. Either add it to the ' +
      'journal with a snapshot (drizzle-kit generate, not by hand) or delete it.'
  );
  process.exit(1);
}
console.log(`every .sql file is in the journal (${journalTags.size} entries).`);

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
