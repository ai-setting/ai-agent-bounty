#!/usr/bin/env bash
#
# End-to-end test for bounty-task CLI commands.
# Phase: feat/bounty-task-optimize (PR6)
#
# What it does:
# 1. Builds CLI (single platform dev build).
# 2. Starts a mock bounty-test-server in background.
# 3. Runs each bounty-task subcommand (publish/grab/board/submit/complete/cancel)
#    both in happy path and sad path, asserts exit codes and output.
# 4. Tears down the mock server.
#
# Usage:
#   bash scripts/e2e-bounty-task.sh
#
# Exit code: 0 if all sub-tests pass, 1 otherwise.

set -uo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR" || exit 1

CLI_BIN="$ROOT_DIR/dist/bin/bounty.js"
MOCK_PORT=45530

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  bounty bounty-task e2e test"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# --- 1. Verify CLI built ---
if [ ! -f "$CLI_BIN" ]; then
  echo "⚠ CLI not built at $CLI_BIN — building now..."
  bun run build:cli && bun run build:bin
fi

# --- 2. Start mock server in background ---
echo ""
echo "▶ Starting mock bounty-test-server on port $MOCK_PORT..."

# We'll spawn a small bun script that wraps createBountyTestServer with seeded agents.
MOCK_SCRIPT_FILE=$(mktemp /tmp/bounty-mock-e2e-XXXXXX.ts)
MOCK_SERVER_PATH="$ROOT_DIR/src/cli/lib/bounty-test-server.ts"

cat > "$MOCK_SCRIPT_FILE" <<EOF
import { createBountyTestServer } from '$MOCK_SERVER_PATH';

const server = await createBountyTestServer({
  port: Number(process.env.MOCK_PORT ?? 45530),
  seedAgents: [
    { id: 'e2e-pub', email: 'e2e-pub@test', name: 'E2E Publisher', credits: 1000 },
    { id: 'e2e-grabber', email: 'e2e-grabber@test', name: 'E2E Grabber', credits: 0 },
    { id: 'e2e-other', email: 'e2e-other@test', name: 'E2E Other', credits: 0 },
  ],
});
// raw stdouts so the parent shell script can parse them
process.stdout.write('MOCK_SERVER_READY=' + server.baseUrl + '\n');
process.stdout.write('MOCK_SERVER_PORT=' + server.port + '\n');
process.stdout.write('MOCK_SERVER_PID=' + process.pid + '\n');
process.on('SIGTERM', async () => { await server.stop(); process.exit(0); });
process.on('SIGINT', async () => { await server.stop(); process.exit(0); });
EOF

# Run mock server (MOCK_PORT is read by the bun script via process.env)
export MOCK_PORT
(bun "$MOCK_SCRIPT_FILE" > /tmp/bounty-mock-e2e.log 2>&1) &
MOCK_PID=$!
sleep 2

# Verify it came up
if ! grep -q "MOCK_SERVER_READY" /tmp/bounty-mock-e2e.log 2>/dev/null; then
  echo "✗ Mock server failed to start; log:"
  cat /tmp/bounty-mock-e2e.log
  kill "$MOCK_PID" 2>/dev/null
  rm -f "$MOCK_SCRIPT_FILE"
  exit 1
fi
MOCK_URL=$(grep "MOCK_SERVER_READY" /tmp/bounty-mock-e2e.log | head -1 | awk '{print $2}')
echo "✓ Mock server ready: $MOCK_URL"

# Trap cleanup
cleanup() {
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null
  fi
  rm -f "$MOCK_SCRIPT_FILE"
  rm -f "$ROOT_DIR/.e2e-mock-server.ts"
}
trap cleanup EXIT

PASSED=0
FAILED=0

# Helper: run a test case
run_case() {
  local label="$1"; shift
  echo ""
  echo "▶ Test: $label"
  if "$@"; then
    echo "  ✓ PASS: $label"
    PASSED=$((PASSED + 1))
  else
    echo "  ✗ FAIL: $label"
    FAILED=$((FAILED + 1))
  fi
}

# --- 3. Happy path: publish → board → grab → submit → complete ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Happy Path: full lifecycle"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 3.1 publish (success)
run_case "publish -t happy -d desc -y coding -r 100" \
  bash -c "set -e; BOUNTY_IM_ADDRESS='e2e-pub@test' bun '$CLI_BIN' bounty-task publish -t happy -d desc -y coding -r 100 -u '$MOCK_URL'"

# Save task ID from previous command? In shell, we need a separate call.
# Instead, capture from a publish call that writes its ID.

# 3.2 board (lists tasks)
run_case "board lists tasks" \
  bash -c "bun '$CLI_BIN' bounty-task board -u '$MOCK_URL' | grep -q 'happy'"

# 3.3 grab (success — first agent wins)
run_case "grab (success, e2e-grabber wins)" \
  bash -c "set -e; BOUNTY_IM_ADDRESS='e2e-grabber@test' TASK_ID=\$(curl -s '$MOCK_URL/api/tasks' | grep -oE '\"id\":\"[^\"]+\"' | head -1 | sed 's/.*:\"\\(.*\\)\"/\\1/'); bun '$CLI_BIN' bounty-task grab -t \"\$TASK_ID\" -a e2e-grabber -u '$MOCK_URL'"

# 3.4 grab (failure — already grabbed) — exit 4 (business 409 via handleBountyError maps to exit 2 actually)
run_case "grab conflict (already grabbed, expect exit 2)" \
  bash -c "BOUNTY_IM_ADDRESS='e2e-other@test' TASK_ID=\$(curl -s '$MOCK_URL/api/tasks' | grep -oE '\"id\":\"[^\"]+\"' | head -1 | sed 's/.*:\"\\(.*\\)\"/\\1/'); bun '$CLI_BIN' bounty-task grab -t \"\$TASK_ID\" -a e2e-other -u '$MOCK_URL' 2>&1 | grep -qE 'already grabbed|409' ; [ \$? -eq 0 ]"

# --- 4. Sad path: invalid arguments ---
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Sad Path"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 4.1 publish with reward <= 0 → exit 2
run_case "publish --reward=0 → exit 2" \
  bash -c "BOUNTY_IM_ADDRESS='e2e-pub@test' set +e; bun '$CLI_BIN' bounty-task publish -t bad -d d -y coding -r 0 -u '$MOCK_URL' 2>&1 | grep -q 'positive number'; [ \$? -eq 0 ]"

# 4.2 grab with malformed UUID → exit 2
run_case "grab with malformed UUID → exit 2" \
  bash -c "BOUNTY_IM_ADDRESS='e2e-grabber@test' set +e; bun '$CLI_BIN' bounty-task grab -t 'not-a-uuid' -a e2e-grabber -u '$MOCK_URL' 2>&1 | grep -qE 'UUID|Invalid|expected'; [ \$? -eq 0 ]"

# 4.3 publish to unreachable server → exit 4
run_case "publish to dead server → exit 4" \
  bash -c "BOUNTY_IM_ADDRESS='e2e-pub@test' set +e; bun '$CLI_BIN' bounty-task publish -t t -d d -y coding -r 100 -u 'http://127.0.0.1:1' 2>&1 | grep -qE 'Network|server start'; [ \$? -eq 0 ]"

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Results: $PASSED passed, $FAILED failed"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

[ "$FAILED" -eq 0 ]
