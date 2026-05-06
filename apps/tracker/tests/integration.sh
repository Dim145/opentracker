#!/usr/bin/env bash
# Integration tests for the Go tracker.
#
# Spins up Postgres + Redis + the tracker via docker compose, runs a
# sequence of HTTP announces against the binary, then asserts the side
# effects in Postgres and Redis. Cleans up after itself.
#
# Usage: ./apps/tracker/tests/integration.sh
#
# Exit code 0 = all assertions passed.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$PROJECT_ROOT"

# Pin a unique compose project name so we don't collide with the user's stack.
PROJECT_NAME="trackarr-tracker-itest"
COMPOSE="docker compose --project-name $PROJECT_NAME"

# Use the loadtest compose file: tracker + postgres + redis (no api / web).
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"; $COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" down -v >/dev/null 2>&1 || true' EXIT

cat > "$ENV_FILE" <<EOF
DB_USER=tracker
DB_PASSWORD=trackertest
DB_NAME=trackarr
REDIS_PASSWORD=redistest
IP_HASH_SECRET=integration-test-secret
TRACKER_DEBUG=false
EOF

PASS() { printf '\033[0;32m  ✓\033[0m %s\n' "$1"; }
FAIL() { printf '\033[0;31m  ✗\033[0m %s\n' "$1"; exit 1; }
STEP() { printf '\n\033[1;36m── %s\033[0m\n' "$1"; }

# Tracker port (exposed by docker-compose.loadtest.yml as 8080).
TRACKER_URL="http://localhost:8080"

# A 20-byte info_hash (URL-encoded) and matching 40-char hex form.
INFO_HASH_RAW="%aa%bb%cc%dd%ee%ff%00%11%22%33%44%55%66%77%88%99%aa%bb%cc%dd"
INFO_HASH_HEX="aabbccddeeff00112233445566778899aabbccdd"
PEER_ID="12345678901234567890"
PASSKEY="itest-passkey-$$"

STEP "Build tracker image"
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" build tracker >/dev/null
PASS "image built"

STEP "Start stack"
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" up -d >/dev/null
PASS "containers up"

STEP "Wait for tracker readiness"
for i in $(seq 1 30); do
  if curl -sf "$TRACKER_URL/health" >/dev/null 2>&1; then
    PASS "/health returns 200"
    break
  fi
  sleep 1
  if [ "$i" = "30" ]; then FAIL "tracker did not become ready in 30s"; fi
done

STEP "Schema bootstrap (apply Drizzle migrations)"
# We need the DB schema before we can insert fixtures. The api container
# usually runs the migrations on startup; here we apply them via the
# drizzle-kit running inside the api image.
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T postgres \
  psql -U tracker -d trackarr -f /docker-entrypoint-initdb.d/init.sql >/dev/null 2>&1 || true
# Apply schema by running drizzle from the host (uses pnpm).
( cd "$PROJECT_ROOT" && \
  DATABASE_URL="postgres://tracker:trackertest@localhost:5432/trackarr?sslmode=disable" \
  pnpm --filter @trackarr/db exec drizzle-kit push --force >/dev/null 2>&1 ) || \
  FAIL "drizzle-kit push failed"
PASS "schema applied"

STEP "Insert test fixtures"
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T postgres \
  psql -U tracker -d trackarr -v ON_ERROR_STOP=1 <<SQL >/dev/null
INSERT INTO users (id, username, auth_salt, auth_verifier, passkey, is_admin, is_moderator, is_banned, uploaded, downloaded, invites_remaining, created_at, last_seen)
VALUES ('itest-user', 'itest', 'salt', 'verifier', '$PASSKEY', false, false, false, 0, 0, 0, NOW(), NOW());

INSERT INTO torrents (id, info_hash, name, size, uploader_id, is_active, is_approved, created_at)
VALUES ('itest-torrent', '$INFO_HASH_HEX', 'IntegrationTest', 1000, 'itest-user', true, true, NOW());
SQL
PASS "fixtures inserted"

# ---------------------------------------------------------------------------
# 1. Reject announces missing required fields.
# ---------------------------------------------------------------------------
STEP "Announce: missing info_hash → bencode failure"
RESP=$(curl -sf "$TRACKER_URL/announce")
case "$RESP" in
  d14:failure?reason17:Missing?info_hashe) PASS "rejected with 'Missing info_hash'" ;;
  *) FAIL "unexpected response: $RESP" ;;
esac

STEP "Announce: invalid passkey → bencode failure"
RESP=$(curl -sf "$TRACKER_URL/announce?info_hash=$INFO_HASH_RAW&peer_id=$PEER_ID&port=6881&uploaded=0&downloaded=0&left=0&passkey=wrong")
case "$RESP" in
  d14:failure?reason15:Invalid?passkeye) PASS "rejected with 'Invalid passkey'" ;;
  *) FAIL "unexpected response: $RESP" ;;
esac

# ---------------------------------------------------------------------------
# 2. Valid announce: peer must land in Redis, response must be valid bencode.
# ---------------------------------------------------------------------------
STEP "Announce: started (left=1000) → bencode success, peer in Redis"
RESP=$(curl -sf "$TRACKER_URL/announce?info_hash=$INFO_HASH_RAW&peer_id=$PEER_ID&port=6881&uploaded=0&downloaded=0&left=1000&event=started&passkey=$PASSKEY")
case "$RESP" in
  d8:complete*) PASS "valid bencode announce response received" ;;
  *) FAIL "unexpected response: $RESP" ;;
esac

REDIS_PEERS=$($COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T redis \
  redis-cli -a redistest --no-auth-warning HLEN "ot:peers:$INFO_HASH_HEX")
[ "$REDIS_PEERS" = "1" ] && PASS "redis HLEN = 1" || FAIL "expected 1 peer, got $REDIS_PEERS"

# Peer JSON must contain the expected ip/port/isSeeder=false (left>0).
PEER_HEX=$(printf '%s' "$PEER_ID" | xxd -p | tr -d '\n')
PEER_JSON=$($COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T redis \
  redis-cli -a redistest --no-auth-warning HGET "ot:peers:$INFO_HASH_HEX" "$PEER_HEX")
echo "$PEER_JSON" | grep -q '"isSeeder":false' && PASS "leecher recorded with isSeeder=false" \
  || FAIL "peer JSON missing isSeeder=false: $PEER_JSON"

# ---------------------------------------------------------------------------
# 3. event=completed should bump the completed counter and create HnR entry
#    when HnR is enabled in settings.
# ---------------------------------------------------------------------------
STEP "Enable HnR + announce completed"
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T postgres \
  psql -U tracker -d trackarr -c \
  "INSERT INTO settings (key, value, updated_at) VALUES ('hnr_enabled', 'true', NOW()) ON CONFLICT (key) DO UPDATE SET value = 'true';" >/dev/null
# Settings cache is 60s; restart tracker to clear it.
$COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" restart tracker >/dev/null
sleep 3

curl -sf "$TRACKER_URL/announce?info_hash=$INFO_HASH_RAW&peer_id=$PEER_ID&port=6881&uploaded=1024&downloaded=1024&left=0&event=completed&passkey=$PASSKEY" >/dev/null
sleep 1 # HnR write is async (background goroutine)

COMPLETED=$($COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T redis \
  redis-cli -a redistest --no-auth-warning HGET "ot:stats:$INFO_HASH_HEX" completed)
[ "$COMPLETED" = "1" ] && PASS "stats.completed = 1" || FAIL "expected completed=1, got $COMPLETED"

HNR_ROWS=$($COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T postgres \
  psql -U tracker -d trackarr -tAc "SELECT count(*) FROM hnr_tracking WHERE user_id = 'itest-user' AND torrent_id = 'itest-torrent';")
[ "$HNR_ROWS" = "1" ] && PASS "hnr_tracking row created" || FAIL "expected 1 hnr row, got $HNR_ROWS"

# ---------------------------------------------------------------------------
# 4. event=stopped removes the peer from Redis.
# ---------------------------------------------------------------------------
STEP "Announce: stopped → peer removed"
curl -sf "$TRACKER_URL/announce?info_hash=$INFO_HASH_RAW&peer_id=$PEER_ID&port=6881&uploaded=2000&downloaded=1024&left=0&event=stopped&passkey=$PASSKEY" >/dev/null
sleep 0.5
REDIS_PEERS=$($COMPOSE -f docker-compose.loadtest.yml --env-file "$ENV_FILE" exec -T redis \
  redis-cli -a redistest --no-auth-warning HLEN "ot:peers:$INFO_HASH_HEX" 2>/dev/null || echo 0)
[ "$REDIS_PEERS" = "0" ] && PASS "peer removed (HLEN = 0)" || FAIL "expected 0 peers, got $REDIS_PEERS"

# ---------------------------------------------------------------------------
# 5. /scrape returns valid bencode for a known info_hash.
# ---------------------------------------------------------------------------
STEP "Scrape known info_hash"
RESP=$(curl -sf "$TRACKER_URL/scrape?info_hash=$INFO_HASH_RAW")
echo "$RESP" | grep -q "5:files" && PASS "scrape response contains 'files' dict" \
  || FAIL "scrape response unexpected: $RESP"

echo
printf '\033[1;32mAll integration tests passed ✓\033[0m\n'
