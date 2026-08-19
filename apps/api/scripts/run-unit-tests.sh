#!/usr/bin/env sh
# Run the @trackarr/api unit suite (test/*.test.ts) inside Docker.
#
# No database, no network: this suite covers pure units. The only reason it
# needs a container is that the host's node_modules holds darwin/win32 native
# binaries (rollup, esbuild), which a Linux runtime cannot load — the same
# reason the integration script masks them with named volumes.
#
# Usage:  sh apps/api/scripts/run-unit-tests.sh [vitest args…]
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)

docker run --rm \
  -v "$REPO_ROOT":/app -w /app \
  -v trackarr-pnpm-store:/pnpm-store \
  -v trackarr-itest-nm-root:/app/node_modules \
  -v trackarr-itest-nm-api:/app/apps/api/node_modules \
  -v trackarr-itest-nm-db:/app/packages/db/node_modules \
  -v trackarr-itest-nm-shared:/app/packages/shared/node_modules \
  node:24-alpine sh -c "
    set -e
    corepack enable
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --filter '@trackarr/api...' --filter '@trackarr/db...' --prefer-offline
    pnpm --filter @trackarr/api exec vitest run $*
  "
