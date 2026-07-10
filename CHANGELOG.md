# Changelog

All notable changes to ai-agent-bounty are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added (bounty-task CLI v0.6 — feat/bounty-task-optimize)

**HTTP API migration** (PR2 / PR3):
- All 6 `bounty bounty-task <sub>` commands migrated from local SQLite
  to HTTP API (aligned with `bounty com send`).
- New `--server-url / -u` option on every subcommand (overrides BOUNTY_API_URL).
- Automatic JWT token reading from `~/.config/bounty/token`.
- Default agent inference from `BOUNTY_IM_ADDRESS` env
  (e.g., `agent-uuid@host` → `agent-uuid`).

**Tier B: UX improvements** (PR4):
- New `--json` flag → output raw JSON to stdout (programmatic parsing).
- New `--quiet / -q` flag → output minimal `id: <id>` line for shell chaining.
- New `--idempotency-key / -k` flag → safe retry without duplicate tasks.
- Input validation: reward > 0, task-id must be UUID v4.
- Error classification: friendly messages + exit codes
  (1=unexpected, 2=business, 3=auth, 4=network/server).

**Tier C: Robustness** (PR5):
- Exponential backoff retry for transient failures
  (network errors, HTTP 502/503/504, default 3 retries with jitter).

**Tier D: Production hardening**:
- **D.1**: `grab` command returns HTTP 409 + `currentOwner` info on race
  condition; client prints "currently held by" hint.
- **D.2**: `withAuthRetry()` middleware — transparent 401 token refresh
  (caller-supplied `onRefresh` callback, e.g., `bounty auth refresh`).
- **D.3**: `--description-file / -f` flag — read description from file
  (handles large descriptions >50KB).
- **D.4**: Idempotency-Key auto-generated from uuid+title+publisher
  (SHA-256, 128-bit truncation) + manual override via `--idempotency-key`.

**Test infrastructure** (PR0):
- New `createBountyTestServer()` helper — minimal in-memory HTTP server
  backed by real `BountyRoutes` + `AuthRoutes` for fast unit tests.

**Documentation & tooling** (PR6):
- Updated `BOUNTY_CAPABILITIES` prompt with new flags and error codes.
- Updated README bounty-task section with `--server-url` /
  `--publisher-id` / `--agent-id` table and examples.
- New `scripts/e2e-bounty-task.sh` — end-to-end shell test
  (mock server + 5 subcommands × happy/sad paths).

### Stats
- Commits ahead of main: **7**
- Tests: **522 pass, 0 fail** (baseline was 491, +31 new tests)
- Files changed: 15+ across CLI, server, docs
- Backward-compatible: existing `bounty com send` and other commands unchanged.

## [0.5.1] - 2026-07-09

### Changed
- Migrate bounty-im handler to @ai-setting/roy-agent-core (Task #1645).
- K8s ingress.yaml dedupe.
- Initial `web/` frontend sub-project.

## [0.5.0] - 2026-07-08

### Added
- TLS skip default for CLI (v0.5.0) — `bountyFetch()` wrapper.
- `--tls-verify` flag to re-enable TLS validation.
- `--insecure / -k` flag for backwards compatibility.