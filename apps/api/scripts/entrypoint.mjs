// Distroless-friendly entrypoint (no shell available).
// 1. Push the database schema via drizzle-kit (replaces the previous
//    `pnpm --filter @trackarr/db exec drizzle-kit push --force`).
// 2. Abort the boot if that push did not actually apply.
// 3. Boot the Nitro server in-process.
//
// Step 2 is not paranoia. drizzle-kit can print a fatal error, apply nothing,
// and exit 0 — so this used to log "Schema up to date" and start the API on a
// schema that had not been migrated, turning a boot-time failure into runtime
// errors with a boot log that claimed success. The outcome is now read from the
// output too; see scripts/migrationOutcome.mjs for the signatures and why no
// env var can auto-answer a rename prompt. Two switches:
//
//   SKIP_DB_MIGRATIONS=true          don't push at all (schema managed
//                                    elsewhere, or applied by hand)
//   IGNORE_DB_MIGRATION_FAILURE=true push, and boot even if it failed
//
// stdin is /dev/null rather than inherited, so the prompt fails the same way
// whether or not someone passed `docker run -it`: a container entrypoint that
// blocks on a question nobody is watching is worse than one that exits.
//
// Why MIGRATIONS_DATABASE_URL is separate from DATABASE_URL:
//   In the prod compose the runtime DATABASE_URL points to PgBouncer in
//   transaction-pooling mode (so the API's per-request connections share
//   a small pool). drizzle-kit's `Pulling schema from database…` step
//   uses session-level state — temp tables, prepared statements,
//   advisory locks — that pgbouncer's transaction pooler discards
//   between statements. The push silently fails with exit code 1 mid-
//   introspection (it was the recurring "[Boot] drizzle-kit push exited
//   with 1" loop). Migrations therefore connect *directly* to Postgres
//   via MIGRATIONS_DATABASE_URL when present, then we hand off to the
//   server which keeps using the pooled DATABASE_URL.
//
// Notes on env-var-driven runtimeConfig:
//   The web container is Nuxt (reads NUXT_PUBLIC_*) and the api is Nitro
//   standalone (reads NITRO_PUBLIC_* by default). To let a single env var
//   like NUXT_PUBLIC_TRACKER_HTTP_URL drive both, the api Dockerfile sets
//   NITRO_ENV_PREFIX=NUXT_ — Nitro then accepts both NITRO_PUBLIC_FOO and
//   NUXT_PUBLIC_FOO when resolving runtimeConfig overrides at startup.
//
// We `import()` the server bundle from the same Node process rather than
// `spawn()`-ing a child so the API runs as PID 1 — graceful shutdown signals
// from Docker/Kubernetes reach Nitro directly.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  classifyPushOutcome,
  formatPushFailure,
} from './migrationOutcome.mjs';

const SKIP = process.env.SKIP_DB_MIGRATIONS === 'true';
// Boot anyway when the push failed. Off by default: a container that starts on
// a schema it failed to migrate serves runtime errors while its boot log claims
// success, which is the exact trap this replaced. Kept as an opt-out for stacks
// that manage the schema elsewhere and only want the API up.
const IGNORE_FAILURE = process.env.IGNORE_DB_MIGRATION_FAILURE === 'true';
// pnpm hoists most deps to db-tools/node_modules/.pnpm/<pkg>@<ver>/node_modules,
// then symlinks them under the consuming workspace. drizzle-kit's binary is
// reachable via the symlinked package dir.
const DRIZZLE_BIN =
  '/app/db-tools/packages/db/node_modules/drizzle-kit/bin.cjs';
const SCHEMA = '/app/db-tools/packages/db/src/schema.ts';
const SERVER_ENTRY = '/app/.output/server/index.mjs';

if (!process.env.DATABASE_URL) {
  console.error('[Boot] DATABASE_URL is required');
  process.exit(1);
}

if (!existsSync(SERVER_ENTRY)) {
  console.error(`[Boot] server bundle missing at ${SERVER_ENTRY}`);
  process.exit(1);
}

if (!SKIP) {
  if (!existsSync(DRIZZLE_BIN)) {
    console.error(`[Boot] drizzle-kit missing at ${DRIZZLE_BIN}`);
    process.exit(1);
  }

  // Prefer the migration-specific URL (direct to Postgres). Fall back to
  // DATABASE_URL so dev / CI / local-prod stacks that don't run a pooler
  // continue to work without extra config.
  const migrationUrl =
    process.env.MIGRATIONS_DATABASE_URL || process.env.DATABASE_URL;
  const usingPoolerForMigrations =
    !process.env.MIGRATIONS_DATABASE_URL && /pgbouncer/i.test(migrationUrl);
  if (usingPoolerForMigrations) {
    console.warn(
      '[Boot] DATABASE_URL appears to point at PgBouncer. Set ' +
        'MIGRATIONS_DATABASE_URL to a direct Postgres URL to avoid ' +
        'transaction-pool incompatibilities with drizzle-kit push.'
    );
  }

  console.log('[Boot] Pushing database schema...');
  const t0 = Date.now();
  // Output is captured as well as forwarded: drizzle-kit can fail and still
  // exit 0 (see scripts/migrationOutcome.mjs), so the status code alone cannot
  // be trusted. Forwarding keeps the operator's diagnostics in the container
  // log; capturing lets us read them back.
  const { code, output } = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        DRIZZLE_BIN,
        'push',
        '--force',
        `--schema=${SCHEMA}`,
        '--dialect=postgresql',
        `--url=${migrationUrl}`,
      ],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        cwd: '/app/db-tools',
        env: {
          ...process.env,
          // drizzle-kit renders a TTY spinner by default. In Docker the
          // entrypoint is non-interactive, and on stdout-piped runtimes
          // (k8s, journald) the spinner's escape codes garble the log.
          // CI=1 and NO_COLOR=1 switch it to plain logging — same effect
          // as `--force` already gives for prompts, but for output too.
          CI: '1',
          NO_COLOR: '1',
        },
      }
    );
    let buf = '';
    child.stdout.on('data', (d) => {
      buf += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      buf += d;
      process.stderr.write(d);
    });
    child.on('error', reject);
    child.on('exit', (c) => resolve({ code: c, output: buf }));
  });

  const outcome = classifyPushOutcome({ code, output });
  if (!outcome.ok) {
    console.error(formatPushFailure(outcome));
    if (!IGNORE_FAILURE) {
      console.error(
        '[Boot] Refusing to start on a schema that was not migrated. Set ' +
          'IGNORE_DB_MIGRATION_FAILURE=true to boot anyway.'
      );
      process.exit(1);
    }
    console.warn(
      '[Boot] IGNORE_DB_MIGRATION_FAILURE=true — starting anyway. Queries ' +
        'against missing columns will fail at runtime.'
    );
  } else {
    console.log(`[Boot] Schema up to date (${Date.now() - t0}ms)`);
  }
} else {
  console.log('[Boot] Skipping schema push (SKIP_DB_MIGRATIONS=true)');
}

console.log('[Boot] Starting Nitro server...');
await import(SERVER_ENTRY);
