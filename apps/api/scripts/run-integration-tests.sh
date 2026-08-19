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
# Usage:  sh apps/api/scripts/run-integration-tests.sh [vitest args…]
#         sh apps/api/scripts/run-integration-tests.sh test/integration/search.itest.ts
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
NET=trackarr-itest-net
PG=trackarr-itest-pg
RD=trackarr-itest-redis
PG_IMAGE=postgres:17-alpine
RD_IMAGE=redis:7
NODE_IMAGE=node:24-alpine
DB_URL="postgres://tracker:tracker@${PG}:5432/trackarr"
RD_PASS=itest-redis-password
RD_URL="redis://${RD}:6379"

cleanup() {
  docker rm -f "$PG" >/dev/null 2>&1 || true
  docker rm -f "$RD" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

cleanup
docker network create "$NET" >/dev/null
docker run -d --name "$PG" --network "$NET" \
  -e POSTGRES_USER=tracker -e POSTGRES_PASSWORD=tracker -e POSTGRES_DB=trackarr \
  "$PG_IMAGE" >/dev/null

# Redis : plusieurs gardes d'idempotence en dépendent — le crédit de connexion
# quotidienne pose une clé SET NX, le collecteur de bonus prend un verrou
# inter-répliques. Les tester contre un faux en mémoire ne prouverait rien,
# puisque c'est justement l'atomicité de Redis qui fait la garantie.
docker run -d --name "$RD" --network "$NET" \
  "$RD_IMAGE" redis-server --requirepass "$RD_PASS" >/dev/null

# Readiness: run a real query, not `pg_isready`. The postgres image starts a
# temporary server to run initdb and *then* restarts for real; pg_isready
# answers yes to that temporary one, so the next command would race against
# the restart and fail with "no such file or directory" on the socket.
# Requiring an actual SELECT to succeed twice in a row clears both phases.
printf 'waiting for postgres'
ready=0
hits=0
for _ in $(seq 1 90); do
  if docker exec "$PG" psql -U tracker -d trackarr -tAc 'SELECT 1' >/dev/null 2>&1; then
    hits=$((hits + 1))
    [ "$hits" -ge 2 ] && { ready=1; break; }
  else
    hits=0
  fi
  printf '.'
  sleep 1
done
printf '\n'
[ "$ready" = 1 ] || { echo "postgres did not become ready in time"; exit 1; }

# The schema declares trigram and full-text indexes that need pg_trgm. The
# real migrations create the extension, but `drizzle-kit push` works from
# schema.ts and doesn't run migration SQL, so create it here or push aborts
# mid-way on gin_trgm_ops.
docker exec "$PG" psql -U tracker -d trackarr -v ON_ERROR_STOP=1 \
  -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;' >/dev/null

printf 'waiting for redis'
for _ in $(seq 1 30); do
  docker exec "$RD" redis-cli -a "$RD_PASS" --no-auth-warning PING 2>/dev/null | grep -q PONG && break
  printf '.'; sleep 1
done
printf '\n'

# node_modules are masked with named volumes rather than inherited from the
# host bind mount. The host installs darwin/win32 binaries; rollup, esbuild
# and friends ship per-platform native modules, so a macOS node_modules
# mounted into a Linux container fails with "Cannot find module
# @rollup/rollup-linux-*". Named volumes keep the Linux install warm between
# runs, so only the first run pays for it.
docker run --rm --network "$NET" \
  -v "$REPO_ROOT":/app -w /app \
  -v trackarr-pnpm-store:/pnpm-store \
  -v trackarr-itest-nm-root:/app/node_modules \
  -v trackarr-itest-nm-api:/app/apps/api/node_modules \
  -v trackarr-itest-nm-db:/app/packages/db/node_modules \
  -v trackarr-itest-nm-shared:/app/packages/shared/node_modules \
  -e DATABASE_URL="$DB_URL" -e DB_SSL=false \
  -e REDIS_URL="$RD_URL" -e REDIS_PASSWORD="$RD_PASS" \
  -e CHANNEL_ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  "$NODE_IMAGE" sh -c "
    set -e
    corepack enable
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --filter '@trackarr/api...' --filter '@trackarr/db...'
    echo '=== drizzle-kit push (schema) ==='
    pnpm --filter @trackarr/db exec drizzle-kit push --force
    echo '=== integration tests ==='
    pnpm --filter @trackarr/api exec vitest run --config vitest.integration.config.ts $*
  "
