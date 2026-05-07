// Distroless-friendly entrypoint (no shell available).
// 1. Push the database schema via drizzle-kit (replaces the previous
//    `pnpm --filter @trackarr/db exec drizzle-kit push --force`).
// 2. Boot the Nitro server in-process.
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

const SKIP = process.env.SKIP_DB_MIGRATIONS === 'true';
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
  console.log('[Boot] Pushing database schema...');
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        DRIZZLE_BIN,
        'push',
        '--force',
        `--schema=${SCHEMA}`,
        '--dialect=postgresql',
        `--url=${process.env.DATABASE_URL}`,
      ],
      { stdio: 'inherit', cwd: '/app/db-tools' }
    );
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`drizzle-kit push exited with ${code}`))
    );
  });
  console.log(`[Boot] Schema up to date (${Date.now() - t0}ms)`);
} else {
  console.log('[Boot] Skipping schema push (SKIP_DB_MIGRATIONS=true)');
}

console.log('[Boot] Starting Nitro server...');
await import(SERVER_ENTRY);
