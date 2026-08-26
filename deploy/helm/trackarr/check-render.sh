#!/usr/bin/env sh
# Render-time checks for the combinations `helm lint` cannot judge.
#
# `helm template` succeeding proves only that the Go templates ran. It does not
# notice a pod referencing a Secret no template creates, which is exactly how
# the externalRedis path stayed broken: with `valkey.enabled: false` and
# `externalRedis.password` set, two containers pointed at
# `{release}-valkey-auth` while valkey-auth.yaml was gated on
# `valkey.enabled` — so nothing created it and every pod came up
# CreateContainerConfigError. It rendered clean and linted clean.
#
# So the assertions here are about the SHAPE of the render: every secretKeyRef
# either names a Secret this chart creates or one the operator was asked to
# supply, the storage driver wires the right variables, and the combinations
# that cannot work fail loudly rather than installing.
#
# Runs entirely in containers. Dependencies must already be vendored:
#   helm dependency update deploy/helm/trackarr
#
# Usage:  sh deploy/helm/trackarr/check-render.sh
set -eu

CHART_DIR=$(cd "$(dirname "$0")" && pwd)
HELM_IMAGE=alpine/helm:latest
RELEASE=chk
fails=0

ok(){ echo "  PASS  $1"; }
no(){ echo "  FAIL  $1"; fails=$((fails + 1)); }

if ! ls "$CHART_DIR/charts"/*.tgz >/dev/null 2>&1; then
  echo "charts/ is empty — run: helm dependency update deploy/helm/trackarr"
  exit 1
fi

render() {
  docker run --rm -v "$CHART_DIR:/chart:ro" --entrypoint helm "$HELM_IMAGE" \
    template "$RELEASE" /chart -n trackarr "$@" 2>&1
}

# Every `secretKeyRef.name` in the render must appear as a Secret the render
# also creates, or be one of the names the operator supplied. This is the check
# that would have caught the externalRedis bug.
assert_secret_refs_resolve() {
  label=$1; shift
  supplied=$1; shift
  out=$(render "$@") || { no "$label — le rendu a échoué: $(printf '%s' "$out" | tail -2)"; return; }

  created=$(printf '%s\n' "$out" | awk '
    /^kind: Secret$/ { insecret = 1; next }
    /^---/           { insecret = 0 }
    insecret && /^  name:/ { print $2; insecret = 0 }
  ' | tr -d '"' | sort -u)

  refs=$(printf '%s\n' "$out" | grep -A 2 'secretKeyRef:' \
    | grep -E '^\s+name:' | awk '{print $2}' | tr -d '"' | sort -u)

  missing=""
  for r in $refs; do
    printf '%s\n' "$created" | grep -qx "$r" && continue
    case " $supplied " in *" $r "*) continue ;; esac
    missing="$missing $r"
  done

  if [ -n "$missing" ]; then
    no "$label — secretKeyRef vers un Secret que rien ne crée:$missing"
  else
    ok "$label — tous les secretKeyRef résolvent"
  fi
}

# A combination that cannot work must stop the render with a message naming the
# value to set, not install something that fails at runtime.
assert_fails_with() {
  label=$1; pattern=$2; shift 2
  if out=$(render "$@"); then
    no "$label — le rendu a réussi alors qu'il devait échouer"
  elif printf '%s' "$out" | grep -q "$pattern"; then
    ok "$label — refusé, message attendu"
  else
    no "$label — refusé mais message inattendu: $(printf '%s' "$out" | tail -2)"
  fi
}

assert_contains() {
  label=$1; needle=$2; shift 2
  if render "$@" | grep -q "$needle"; then ok "$label"; else no "$label — \"$needle\" absent"; fi
}

assert_absent() {
  label=$1; needle=$2; shift 2
  if render "$@" | grep -q "$needle"; then no "$label — \"$needle\" présent"; else ok "$label"; fi
}

HOST="--set site.host=x.test"

# Secrets the chart legitimately references without creating them:
#   {release}-postgresql-app  minted by the CloudNativePG operator from the
#                             Cluster resource, so it exists at runtime but
#                             never appears in `helm template` output.
CNPG_SECRET="$RELEASE-postgresql-app"

echo "== Redis =="
# shellcheck disable=SC2086
assert_secret_refs_resolve "valkey embarqué (défaut)" "$CNPG_SECRET" $HOST
assert_secret_refs_resolve "valkey off + externalRedis, sans mot de passe" "$CNPG_SECRET" \
  $HOST --set valkey.enabled=false --set externalRedis.host=10.0.0.5
assert_secret_refs_resolve "valkey off + externalRedis.password" "$CNPG_SECRET" \
  $HOST --set valkey.enabled=false --set externalRedis.host=10.0.0.5 \
  --set externalRedis.password=hunter2
assert_secret_refs_resolve "valkey off + externalRedis.existingSecret" "my-redis $CNPG_SECRET" \
  $HOST --set valkey.enabled=false --set externalRedis.host=10.0.0.5 \
  --set externalRedis.existingSecret=my-redis
assert_secret_refs_resolve "valkey on + externalRedis.existingSecret" "my-redis $CNPG_SECRET" \
  $HOST --set externalRedis.existingSecret=my-redis

# Sans mot de passe, aucun REDIS_PASSWORD ne doit être posé — l'API s'en passe
# désormais (apps/api/redis/client.ts), le tracker l'a toujours fait.
assert_absent "aucun REDIS_PASSWORD quand il n'y en a pas" "name: REDIS_PASSWORD" \
  $HOST --set valkey.enabled=false --set externalRedis.host=10.0.0.5
assert_contains "la clé lue est REDIS_PASSWORD pour un Redis externe" "key: REDIS_PASSWORD" \
  $HOST --set valkey.enabled=false --set externalRedis.host=10.0.0.5 \
  --set externalRedis.existingSecret=my-redis
assert_fails_with "valkey off sans externalRedis.host" "set externalRedis.host" \
  $HOST --set valkey.enabled=false

echo
echo "== base de données =="
assert_fails_with "postgresql off sans externalDatabase" "externalDatabase.url" \
  $HOST --set postgresql.enabled=false

echo
echo "== stockage des uploads =="
assert_contains "fs : UPLOADS_DIR posé" "name: UPLOADS_DIR" $HOST
assert_contains "fs : un PVC uploads existe" "chk-trackarr-uploads" $HOST
assert_absent "fs : pas de variable S3" "name: S3_ENDPOINT" $HOST

S3="--set storage.driver=s3 --set rustfs.enabled=true \
  --set rustfs.secret.rustfs.access_key=a1b2c3d4e5f6 \
  --set rustfs.secret.rustfs.secret_key=0123456789abcdef0123456789abcdef"
# shellcheck disable=SC2086
assert_secret_refs_resolve "s3 + rustfs embarqué" "$CNPG_SECRET" $HOST $S3
assert_absent "s3 : plus de PVC uploads" "chk-trackarr-uploads" $HOST $S3
assert_absent "s3 : plus de UPLOADS_DIR" "name: UPLOADS_DIR" $HOST $S3
assert_contains "s3 : endpoint dérivé du Service RustFS" "http://chk-rustfs-svc:9000" $HOST $S3
assert_fails_with "s3 sans endpoint ni rustfs" "storage.s3.endpoint is empty" \
  $HOST --set storage.driver=s3
assert_fails_with "s3 + rustfs sans identifiants" "must be set to non-default" \
  $HOST --set storage.driver=s3 --set rustfs.enabled=true
assert_fails_with "driver de stockage inconnu" "storage.driver must be" \
  $HOST --set storage.driver=minio

echo
if [ "$fails" -eq 0 ]; then
  echo "render checks: OK"
else
  echo "render checks: $fails échec(s)"
  exit 1
fi
