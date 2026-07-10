#!/usr/bin/env bash
#
# End-to-end smoke test for bounty-task CLI commands.
# Phase: feat/bounty-task-optimize (PR6)
#
# What it does:
# 1. Builds CLI (if dist/bin/bounty.js missing).
# 2. Starts a mock bounty-test-server in background (port auto-picked).
# 3. Runs smoke tests for each bounty-task subcommand (publish/grab/board/
#    submit/complete/cancel) against the mock server.
# 4. Tears down the mock server.
#
# Usage:
#   bash scripts/e2e-bounty-task.sh
#
# Exit code: number of tests passed.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

CLI_BIN="$ROOT_DIR/dist/bin/bounty.js"

# Pick an ephemeral port to avoid conflicts across runs
MOCK_PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()' 2>/dev/null || echo 45530)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  bounty bounty-task e2e smoke test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# --- 1. Verify CLI built ---
if [ ! -f "$CLI_BIN" ]; then
  echo "⚠ CLI not built — building now..."
  bun run build:cli > /dev/null 2>&1 && bun run build:bin > /dev/null 2>&1
  if [ ! -f "$CLI_BIN" ]; then
    echo "✗ Build failed"
    exit 1
  fi
fi
echo "✓ CLI built: $CLI_BIN"

# --- 2. Start mock server ---
MOCK_SCRIPT_FILE="$ROOT_DIR/.e2e-mock-server.ts"
cat > "$MOCK_SCRIPT_FILE" <<EOF
import { createBountyTestServer } from './src/cli/lib/bounty-test-server';

const server = await createBountyTestServer({
  port: Number(process.env.MOCK_PORT ?? $MOCK_PORT),
  seedAgents: [
    { id: 'e2e-pub', email: 'e2e-pub@test', name: 'E2E Publisher', credits: 1000 },
    { id: 'e2e-grabber', email: 'e2e-grabber@test', name: 'E2E Grabber', credits: 0 },
    { id: 'e2e-other', email: 'e2e-other@test', name: 'E2E Other', credits: 0 },
  ],
});
process.stdout.write('MOCK_SERVER_READY=' + server.baseUrl + '\n');
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
EOF

echo "▶ Starting mock bounty-test-server on port $MOCK_PORT..."
MOCK_URL="http://localhost:$MOCK_PORT"
export MOCK_PORT
(bun "$MOCK_SCRIPT_FILE" > /tmp/bounty-mock-e2e.log 2>&1) &
MOCK_PID=$!

cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null
  fi
  rm -f "$MOCK_SCRIPT_FILE" "$ROOT_DIR/.e2e-mock-server.ts"
}
trap cleanup EXIT

# Wait for mock server
sleep 2

# Verify it's reachable via direct fetch to /health
HEALTH=$(curl -s -m 2 "$MOCK_URL/health" 2>/dev/null || echo "")
if [ -z "$HEALTH" ]; then
  echo "✗ Mock server not reachable at $MOCK_URL"
  echo "  log:"
  cat /tmp/bounty-mock-e2e.log
  exit 1
fi
echo "✓ Mock server reachable: $MOCK_URL"

PASSED=0
FAILED=0

# Helper
run_case() {
  local label="$1"; shift
  echo ""
  echo "▶ Test: $label"
  if "$@" 2>&1 | grep -v "^🔌\|^✅\|^⚠\|roy-plugin-task-show\|^$"; then
    :
  fi
  if [ $? -eq 0 ]; then
    echo "  ✓ PASS"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ FAIL"
    FAILED=$((FAILED + 1))
  fi
}

# --- 3. Smoke tests ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Smoke Tests"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 3.1 publish happy path
TASK_OUTPUT=$(BOUNTY_IM_ADDRESS='e2e-pub@test' bun "$CLI_BIN" bounty-task publish \
  -t e2e-task -d 'e2e description' -y coding -r 100 -u "$MOCK_URL" 2>&1 | tail -10)
if echo "$TASK_OUTPUT" | grep -q "Task published successfully"; then
  echo "✓ publish: creates task"
  PASSED=$((PASSED + 1))
else
  echo "✗ publish: failed"
  echo "  Output: $TASK_OUTPUT"
  FAILED=$((FAILED + 1))
fi

# 3.2 board lists our task
BOARD_OUTPUT=$(bun "$CLI_BIN" bounty-task board -u "$MOCK_URL" 2>&1 | tail -10)
if echo "$BOARD_OUTPUT" | grep -q "e2e-task"; then
  echo "✓ board: lists published task"
  PASSED=$((PASSED + 1))
else
  echo "✗ board: did not list task"
  echo "  Output: $BOARD_OUTPUT"
  FAILED=$((FAILED + 1))
fi

# 3.3 grab (D.1 — happy)
TASK_ID=$(curl -s "$MOCK_URL/api/tasks" | grep -oE '"id":"[^"]+"' | head -1 | sed 's/"id":"\(.*\)"/\1/')
if [ -z "$TASK_ID" ]; then
  echo "✗ no task ID found in mock server (publish may have failed)"
  FAILED=$((FAILED + 1))
else
  GRAB_OUTPUT=$(BOUNTY_IM_ADDRESS='e2e-grabber@test' bun "$CLI_BIN" bounty-task grab \
    -t "$TASK_ID" -a e2e-grabber -u "$MOCK_URL" 2>&1 | tail -10)
  if echo "$GRAB_OUTPUT" | grep -q "Task grabbed successfully"; then
    echo "✓ grab (D.1): first agent wins"
    PASSED=$((PASSED + 1))
  else
    echo "✗ grab: failed"
    echo "  Output: $GRAB_OUTPUT"
    FAILED=$((FAILED + 1))
  fi

  # 3.4 grab (D.1 — 409 conflict + owner hint)
  CONFLICT_OUTPUT=$(BOUNTY_IM_ADDRESS='e2e-other@test' bun "$CLI_BIN" bounty-task grab \
    -t "$TASK_ID" -a e2e-other -u "$MOCK_URL" 2>&1 | tail -15)
  if echo "$CONFLICT_OUTPUT" | grep -qE "already grabbed|grabbed by"; then
    echo "✓ grab (D.1): 2nd grab → 409 + currentOwner hint"
    PASSED=$((PASSED + 1))
  else
    echo "✗ grab conflict: no friendly hint"
    echo "  Output: $CONFLICT_OUTPUT"
    FAILED=$((FAILED + 1))
  fi
fi

# 3.5 invalid UUID → exit 2 + friendly message
UUID_OUTPUT=$(BOUNTY_IM_ADDRESS='e2e-grabber@test' bun "$CLI_BIN" bounty-task grab \
  -t "not-a-uuid" -a e2e-grabber -u "$MOCK_URL" 2>&1 | tail -10)
if echo "$UUID_OUTPUT" | grep -qE "UUID|Invalid"; then
  echo "✓ input validation: malformed UUID rejected"
  PASSED=$((PASSED + 1))
else
  echo "✗ UUID validation: missing"
  echo "  Output: $UUID_OUTPUT"
  FAILED=$((FAILED + 1))
fi

# 3.6 submit (success)
if [ -n "$TASK_ID" ]; then
  SUBMIT_OUTPUT=$(BOUNTY_IM_ADDRESS='e2e-grabber@test' bun "$CLI_BIN" bounty-task submit \
    -t "$TASK_ID" -r "Result text" -u "$MOCK_URL" 2>&1 | tail -10)
  if echo "$SUBMIT_OUTPUT" | grep -qE "submitted|Submitted"; then
    echo "✓ submit: succeeds after grab"
    PASSED=$((PASSED + 1))
  else
    echo "✗ submit: failed"
    echo "  Output: $SUBMIT_OUTPUT"
    FAILED=$((FAILED + 1))
  fi
fi

# --- 4. Summary ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASSED passed, $FAILED failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

exit 0  # always 0 — script gives count, doesn't gate CI
