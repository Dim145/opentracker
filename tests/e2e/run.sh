#!/usr/bin/env bash
#
# End-to-end run: build, boot, seed, exercise, tear down.
#
# See README.md. Everything happens in containers except the scenario scripts
# themselves, which are plain Node talking HTTP to the published ports.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
COMPOSE="docker compose -f $HERE/docker-compose.yml"
PROJECT=trackarr-e2e

BUILD=1
KEEP=0
ONLY=""
while [ $# -gt 0 ]; do
  case "$1" in
    --no-build) BUILD=0 ;;
    --keep) KEEP=1 ;;
    --only) ONLY="${2:-}"; shift ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }

cleanup() {
  if [ "$KEEP" = "1" ]; then
    say "stack left running — web http://localhost:53000  api http://localhost:54000"
    echo "  tear down with: $COMPOSE down -v"
  else
    say "tearing down"
    $COMPOSE down -v >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ "$BUILD" = "1" ]; then
  say "building images from the working tree"
  docker build -q -f "$ROOT/apps/api/Dockerfile" -t trackarr-e2e-api:local "$ROOT"
  docker build -q -f "$ROOT/apps/web/Dockerfile" -t trackarr-e2e-web:local "$ROOT"
fi

say "booting"
$COMPOSE down -v >/dev/null 2>&1 || true
$COMPOSE up -d

# The API applies its migrations at boot, so "healthy" also means "schema is
# current". A failed migration aborts the boot, which shows up here as a
# container that never becomes healthy.
say "waiting for health"
for _ in $(seq 1 90); do
  ready=$($COMPOSE ps --format '{{.Service}} {{.Health}}' | grep -c healthy || true)
  [ "$ready" -ge 4 ] && break
  sleep 2
done
if [ "${ready:-0}" -lt 4 ]; then
  $COMPOSE ps
  $COMPOSE logs --tail 40 api
  echo "stack did not come up" >&2
  exit 1
fi
$COMPOSE logs api 2>&1 | grep -E '^\[(Boot|Migrate)\]' || true

# `redis` and `psql` calls below go through the containers, so nothing needs to
# be installed on the host.
redis() { $COMPOSE exec -T redis redis-cli -a e2e-redis-password --no-auth-warning "$@"; }

# See README: the harness clears its own stack's rate-limit counters rather than
# turning the protection off, so the scenarios exercise the same middleware a
# real request goes through.
reset_limits() {
  redis DEL ot:ddos:blacklist >/dev/null 2>&1 || true
  for pat in 'ot:ratelimit:*' 'ot:sec:ipban:*'; do
    keys=$(redis --scan --pattern "$pat" 2>/dev/null || true)
    [ -n "$keys" ] && echo "$keys" | tr '\n' ' ' | xargs -r redis DEL >/dev/null 2>&1 || true
  done
}

say "bundling the browser's crypto module for Node"
# `apps/web/app/utils/crypto.ts` is what the register/login pages use. Bundling
# it rather than reimplementing the flow is the whole point: if the client's
# crypto changes, this harness follows it or fails loudly.
# esbuild writes to STDOUT and the host redirects it, rather than the container
# writing through a bind mount. That is not a style preference: a mount write is
# not reliably visible to the host the instant the container exits — Docker
# Desktop's virtiofs lags, and worse, the host caches the negative lookup, so
# polling for the file can keep failing after it exists. A pipe has no such
# problem.
docker run --rm -v "$ROOT":/repo -w /repo node:24-alpine \
  node_modules/.pnpm/node_modules/.bin/esbuild --bundle --platform=node \
  --format=esm --target=node24 apps/web/app/utils/crypto.ts > "$HERE/crypto.mjs"
[ -s "$HERE/crypto.mjs" ] || { echo "crypto bundle is empty" >&2; exit 1; }

reset_limits
say "seeding accounts through the real auth flow"
node "$HERE/seed.mjs" > "$HERE/session.json"
# `seed.mjs` prints a per-account line on stderr and the jar on stdout. An empty
# stdout means every account failed, which every scenario would then report as a
# cascade of unrelated failures.
[ -s "$HERE/session.json" ] || { echo "seeding produced no sessions" >&2; exit 1; }

status=0
for scenario in "$HERE"/*.mjs; do
  name="$(basename "$scenario" .mjs)"
  case "$name" in seed|crypto|lib) continue ;; esac
  [ -n "$ONLY" ] && [ "$name" != "$ONLY" ] && continue
  reset_limits
  say "scenario: $name"
  node "$scenario" || status=1
done

exit "$status"
