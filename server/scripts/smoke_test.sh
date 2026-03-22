#!/bin/bash
# E2E Smoke Test for SiliconWorld Server
# Usage: ./smoke_test.sh [server_url] [player_key]
# Default: http://localhost:18080 key1

set -e

SERVER_URL="${1:-http://localhost:18080}"
PLAYER_KEY="${2:-key1}"
PLAYER_ID="${3:-p1}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PASS=0
FAIL=0

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASS++))
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAIL++))
}

log_info() {
    echo -e "${YELLOW}[INFO]${NC} $1"
}

# Test health endpoint
test_health() {
    log_info "Testing /health..."
    RESP=$(curl -s "$SERVER_URL/health")
    if echo "$RESP" | grep -q '"status":"ok"'; then
        log_pass "Health check"
    else
        log_fail "Health check failed: $RESP"
    fi
}

# Test metrics endpoint
test_metrics() {
    log_info "Testing /metrics..."
    RESP=$(curl -s "$SERVER_URL/metrics")
    if echo "$RESP" | grep -q '"uptime"'; then
        log_pass "Metrics endpoint"
    else
        log_fail "Metrics endpoint failed: $RESP"
    fi
}

# Test state summary (authorized)
test_summary() {
    log_info "Testing /state/summary..."
    RESP=$(curl -s -H "Authorization: Bearer $PLAYER_KEY" "$SERVER_URL/state/summary")
    if echo "$RESP" | grep -q '"tick"'; then
        TICK=$(echo "$RESP" | grep -o '"tick":[0-9]*' | head -1 | cut -d: -f2)
        log_pass "State summary (tick: $TICK)"
    else
        log_fail "State summary failed: $RESP"
    fi
}

# Test galaxy scan
test_scan_galaxy() {
    log_info "Testing scan_galaxy command..."
    RESP=$(curl -s -X POST \
        -H "Authorization: Bearer $PLAYER_KEY" \
        -H "Content-Type: application/json" \
        -d '{"request_id":"smoke-'"$(date +%s)"'","issuer_type":"player","issuer_id":"'"$PLAYER_ID"'","commands":[{"type":"scan_galaxy","target":{"layer":"galaxy","galaxy_id":"galaxy-1"}}]}' \
        "$SERVER_URL/commands")
    if echo "$RESP" | grep -q '"status"'; then
        log_pass "Scan galaxy command"
    else
        log_fail "Scan galaxy failed: $RESP"
    fi
}

# Test build command
test_build() {
    log_info "Testing build command..."
    RESP=$(curl -s -X POST \
        -H "Authorization: Bearer $PLAYER_KEY" \
        -H "Content-Type: application/json" \
        -d '{"request_id":"smoke-build-'"$(date +%s)"'","issuer_type":"player","issuer_id":"'"$PLAYER_ID"'","commands":[{"type":"build","target":{"layer":"planet","position":{"x":5,"y":5}},"payload":{"building_type":"solar_panel"}}]}' \
        "$SERVER_URL/commands")
    if echo "$RESP" | grep -q '"status"'; then
        log_pass "Build command"
    else
        log_fail "Build command failed: $RESP"
    fi
}

# Test unauthorized access
test_unauthorized() {
    log_info "Testing unauthorized access..."
    RESP=$(curl -s -w "%{http_code}" "$SERVER_URL/state/summary")
    CODE="${RESP: -3}"
    BODY="${RESP:0:${#RESP}-3}"
    if [ "$CODE" = "401" ]; then
        log_pass "Unauthorized access blocked"
    else
        log_fail "Expected 401, got $CODE"
    fi
}

# Test invalid key
test_invalid_key() {
    log_info "Testing invalid key..."
    RESP=$(curl -s -w "%{http_code}" -H "Authorization: Bearer invalid_key" "$SERVER_URL/state/summary")
    CODE="${RESP: -3}"
    if [ "$CODE" = "401" ]; then
        log_pass "Invalid key rejected"
    else
        log_fail "Expected 401 for invalid key, got $CODE"
    fi
}

# Test replay endpoint (smoke - just check it accepts request)
test_replay() {
    log_info "Testing replay endpoint..."
    RESP=$(curl -s -X POST \
        -H "Authorization: Bearer $PLAYER_KEY" \
        -H "Content-Type: application/json" \
        -d '{"from_tick":0,"to_tick":10,"verify":false}' \
        "$SERVER_URL/replay")
    if echo "$RESP" | grep -q '"from_tick"'; then
        log_pass "Replay endpoint accessible"
    else
        # Replay may fail if no snapshots - that's OK
        if echo "$RESP" | grep -q "no snapshot"; then
            log_pass "Replay endpoint works (no snapshots available)"
        else
            log_fail "Replay endpoint failed: $RESP"
        fi
    fi
}

# Test event snapshot
test_events() {
    log_info "Testing event snapshot..."
    RESP=$(curl -s -H "Authorization: Bearer $PLAYER_KEY" "$SERVER_URL/events/snapshot?event_types=command_result&limit=10")
    if echo "$RESP" | grep -q '"events"'; then
        log_pass "Event snapshot endpoint"
    else
        log_fail "Event snapshot failed: $RESP"
    fi
}

# Test audit endpoint
test_audit() {
    log_info "Testing audit endpoint..."
    RESP=$(curl -s -H "Authorization: Bearer $PLAYER_KEY" "$SERVER_URL/audit?limit=10")
    if echo "$RESP" | grep -q '"entries"'; then
        log_pass "Audit endpoint"
    else
        log_fail "Audit endpoint failed: $RESP"
    fi
}

# Run all tests
echo "========================================="
echo "SiliconWorld E2E Smoke Test"
echo "Server: $SERVER_URL"
echo "Player: $PLAYER_ID"
echo "========================================="
echo ""

test_health
test_metrics
test_unauthorized
test_invalid_key
test_summary
test_scan_galaxy
test_build
test_replay
test_events
test_audit

echo ""
echo "========================================="
echo "Results: $PASS passed, $FAIL failed"
echo "========================================="

if [ $FAIL -gt 0 ]; then
    exit 1
fi
exit 0
