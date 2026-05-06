#!/bin/sh
set -e

echo "Running database migrations..."
# pnpm --filter cd's into packages/db so the config path is local.
pnpm --filter @trackarr/db exec drizzle-kit push --force

echo "Starting Nitro API on :${NITRO_PORT:-4000}..."
exec node .output/server/index.mjs
