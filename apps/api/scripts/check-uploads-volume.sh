#!/usr/bin/env sh
# Regression guard: can the API actually write to a FRESH uploads volume?
#
# The bug this exists for: `apps/api/Dockerfile` did not create
# /app/data/uploads, and Docker seeds a brand-new named volume from whatever the
# image holds at the mount point — contents AND ownership. With the path absent
# from the image the volume was created root:root 0755, while the container runs
# as uid 65532, so the very first branding upload on a fresh
# `docker compose -f docker-compose.prod.yml up` died with
#
#   EACCES: permission denied, open '/app/data/uploads/logo-<hex>.png'
#
# Deployments that predated the non-root image kept working, because their
# volume had been seeded while the image still ran as root. That is why nothing
# caught it: it only reproduces on a NEW volume.
#
# This asserts the image property directly — no Postgres, no Redis, no session.
# The write is what the bug was about; the upload route is covered by
# test/integration and by the unit suite.
#
# Usage:  sh apps/api/scripts/check-uploads-volume.sh [image]
#         IMAGE defaults to trackarr-api:volcheck, built from the repo if absent.
set -eu

IMAGE=${1:-trackarr-api:volcheck}
REPO_ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
VOL_NEW=trackarr-volcheck-new
VOL_OLD=trackarr-volcheck-old
fails=0

ok()   { echo "  PASS  $1"; }
no()   { echo "  FAIL  $1"; fails=$((fails + 1)); }

cleanup() {
  docker volume rm "$VOL_NEW" >/dev/null 2>&1 || true
  docker volume rm "$VOL_OLD" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
cleanup

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "building $IMAGE…"
  docker build -f "$REPO_ROOT/apps/api/Dockerfile" -t "$IMAGE" "$REPO_ROOT" >/dev/null
fi

# The runtime user, read from the image rather than hardcoded — distroless
# `nonroot` is 65532 today, and this should keep working if that ever moves.
UID_GID=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" \
  -e 'process.stdout.write(process.getuid() + ":" + process.getgid())')
echo "image $IMAGE runs as $UID_GID"

echo
echo "1. the mount point exists in the image, owned by the runtime user"
OWNER=$(docker run --rm --entrypoint /nodejs/bin/node "$IMAGE" -e '
  const { statSync } = require("fs");
  try {
    const s = statSync("/app/data/uploads");
    process.stdout.write(s.uid + ":" + s.gid);
  } catch (e) { process.stdout.write("MISSING"); }')
if [ "$OWNER" = "MISSING" ]; then
  no "/app/data/uploads is absent from the image — a fresh volume will be root-owned"
elif [ "$OWNER" = "$UID_GID" ]; then
  ok "/app/data/uploads is $OWNER"
else
  no "/app/data/uploads is $OWNER but the process runs as $UID_GID"
fi

echo
echo "2. a fresh named volume is writable with no chown"
RESULT=$(docker run --rm -v "$VOL_NEW:/app/data/uploads" \
  --entrypoint /nodejs/bin/node "$IMAGE" -e '
  const { writeFileSync, statSync } = require("fs");
  try {
    writeFileSync("/app/data/uploads/probe", "x");
    const s = statSync("/app/data/uploads");
    process.stdout.write("OK " + s.uid + ":" + s.gid);
  } catch (e) { process.stdout.write("FAILED " + e.code); }')
case "$RESULT" in
  "OK $UID_GID") ok "wrote to a fresh volume (seeded $UID_GID)" ;;
  OK*)           ok "wrote to a fresh volume, but it is ${RESULT#OK } rather than $UID_GID" ;;
  *)             no "could not write to a fresh volume: ${RESULT#FAILED }" ;;
esac

echo
echo "3. a pre-existing root-owned volume fails with an ACTIONABLE message"
# Docker only seeds a volume that is empty, so a volume created by an affected
# version keeps its root ownership across the upgrade. That case cannot be fixed
# from the image — it has to at least say so clearly.
docker volume create "$VOL_OLD" >/dev/null
docker run --rm -v "$VOL_OLD:/d" alpine:latest \
  sh -c 'touch /d/.keep && chown -R 0:0 /d' >/dev/null
# Asserted through the write itself rather than by reaching into the Nitro
# bundle, whose chunk paths are not a contract. That the refusal becomes a
# fix-me message is covered by the unit suite (test/storageDrivers.test.ts);
# what matters here is that the write is refused rather than silently landing
# somewhere else.
RESULT=$(docker run --rm -v "$VOL_OLD:/app/data/uploads" \
  --entrypoint /nodejs/bin/node "$IMAGE" -e '
  const { writeFileSync } = require("fs");
  try { writeFileSync("/app/data/uploads/probe", "x"); process.stdout.write("WROTE"); }
  catch (e) { process.stdout.write(e.code); }')
case "$RESULT" in
  EACCES|EPERM) ok "refused with $RESULT, which utils/storage/fsDriver.ts turns into a fix-me message" ;;
  WROTE)        no "a root-owned volume was writable — the premise of this check is wrong" ;;
  *)            no "unexpected: $RESULT" ;;
esac

echo
if [ "$fails" -eq 0 ]; then
  echo "uploads volume check: OK"
else
  echo "uploads volume check: $fails failure(s)"
  exit 1
fi
