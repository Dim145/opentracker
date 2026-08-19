#!/usr/bin/env sh
# Run the @trackarr/web unit suite inside Docker.
#
# Same reason as the API's runner: the host's node_modules holds
# darwin/win32 native binaries that a Linux runtime cannot load.
#
# Usage:  sh apps/web/scripts/run-unit-tests.sh [vitest args…]
set -eu

REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)

docker run --rm \
  -v "$REPO_ROOT":/app -w /app \
  -v trackarr-pnpm-store:/pnpm-store \
  -v trackarr-itest-nm-root:/app/node_modules \
  -v trackarr-itest-nm-web:/app/apps/web/node_modules \
  -v trackarr-itest-nm-shared:/app/packages/shared/node_modules \
  node:24-alpine sh -c "
    set -e
    corepack enable
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --filter '@trackarr/web...' --ignore-scripts
    pnpm --filter @trackarr/web exec vitest run $*
  "
