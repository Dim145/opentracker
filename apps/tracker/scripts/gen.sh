#!/usr/bin/env bash
# Regenerate the sqlc-typed Go bindings under internal/queries/.
#
# Run this whenever you change anything under db/queries/ or db/schema.sql.
# Uses the sqlc Docker image so contributors don't need sqlc installed locally.
#
# Usage: ./apps/tracker/scripts/gen.sh

set -euo pipefail

TRACKER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

docker run --rm \
  -v "$TRACKER_DIR":/src \
  -w /src \
  sqlc/sqlc:latest generate

echo "✓ regenerated apps/tracker/internal/queries/"
