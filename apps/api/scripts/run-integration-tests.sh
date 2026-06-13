#!/usr/bin/env sh
# Run the @trackarr/api integration suite (test/integration/*.itest.ts)
# against an ephemeral Postgres. Requires only Docker on the host.
#
#   1. starts postgres:17-alpine on a private docker network
#   2. pushes the drizzle schema (the same `drizzle-kit push --force` the
#      API container runs at boot)
#   3. installs deps + runs the integration suite inside node:24-alpine
#   4. tears the database + network down on exit (success or failure)
#
# Usage:  sh apps/api/scripts/run-integration-tests.sh
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
NET=trackarr-itest-net
PG=trackarr-itest-pg
PG_IMAGE=postgres:17-alpine
NODE_IMAGE=node:24-alpine
DB_URL="postgres://tracker:tracker@${PG}:5432/trackarr"

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=tracker -e POSTGRES_PASSWORD=tracker -e POSTGRES_DB=trackarr \
  "$PG_IMAGE" >/dev/null

printf 'waiting for postgres'
ready=
for _ in $(seq 1 60); do
  if docker exec "$PG" pg_isready -U tracker -d trackarr >/dev/null 2>&1; then ready=1; break; fi
  printf '.'; sleep 1
done
printf '\n'
[ "$ready" = 1 ] || { echo "postgres did not become ready in time"; exit 1; }

# The schema declares a GiST trigram index (torrents_name_trgm_idx) that
# needs the pg_trgm extension. The real migrations create it, but
# `drizzle-kit push` works from schema.ts and doesn't run migration SQL,
# so create it here or push aborts mid-way on gist_trgm_ops.
docker exec "$PG" psql -U tracker -d trackarr -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' >/dev/null

# A named volume keeps the pnpm store warm across runs (first run is slow).
docker run --rm --network "$NET" \
  -v "$REPO_ROOT":/app -w /app \
  -v trackarr-pnpm-store:/pnpm-store \
  -e DATABASE_URL="$DB_URL" -e DB_SSL=false \
  "$NODE_IMAGE" sh -c '
    set -e
    corepack enable
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --filter "@trackarr/api..." --filter "@trackarr/db..."
    echo "=== drizzle-kit push (schema) ==="
    pnpm --filter @trackarr/db exec drizzle-kit push --force
    echo "=== integration tests ==="
    pnpm --filter @trackarr/api test:integration
  '
