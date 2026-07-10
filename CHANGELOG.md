# Changelog

All notable changes to ai-agent-bounty are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.2] - 2026-07-11

### Fixed (hotfix)

- **Standalone-binary `bounty --version` now reports the correct version**.
  The version resolver now accepts both `@ai-setting/agent-bounty` AND
  `@ai-setting/agent-bounty-standalone` as valid package names.
  Previously the standalone binary's package.json (name = `...-standalone`)
  was filtered out by the name check, falling back to `0.0.0-unknown`.
  Test coverage: `tests/cli/package-version.test.ts` (+1 test for standalone name).

## [0.7.1] - 2026-07-11

### Fixed (hotfix)

- **`bounty --version` now reports the correct version from any cwd**.
  Previously `getVersion()` read `process.cwd()/package.json`, which returned
  the wrong version when the CLI was run from a directory containing an
  unrelated `package.json` (e.g., another project or the parent `roy-agent`
  monorepo).
  New `getPackageVersion()` helper walks up from `process.execPath` /
  `import.meta.url` to find `@ai-setting/agent-bounty`'s own package.json.
  Test coverage: `tests/cli/package-version.test.ts` (4 tests).

## [0.7.0] - 2026-07-11

### Added (agent-address identity + soft auth + tolerant publish — feat/bounty-v0.7-address)

**1️⃣ Agent-address CLI flags** (replaces numeric ID flags):

- All 6 `bounty bounty-task` subcommands (`publish`, `grab`, `submit`, `complete`, `cancel`, `board`) now accept `--publisher-address` / `--agent-address` flags.
- All 6 `bounty register-agent` subcommands (`login`, `get`, `delete`, `info`, `credits`, `list`) plus `bounty auth login` now accept `--agent-address`.
- Address format: `<uuid>@<host>` (e.g., `ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com`).
- Pure-uuid (no `@host`) is also accepted for backward compatibility.
- CLI internally extracts `parseAgentAddress(addr).uuid` and sends `agentId`/`publisherId` in request body — server contract unchanged.
- `--publisher-id` / `--agent-id` flags still work but emit a deprecation warning (`console.warn("⚠ ... is deprecated; use ... instead.")`).

**2️⃣ Soft auth** (token is optional, server decides enforcement):

- New `attachSoftAuth()` helper — auto-loads token from `~/.config/bounty/token` but **never throws** if missing.
- Missing token → request is sent without `Authorization` header (server decides whether the endpoint requires auth).
- Replaces hard `loadToken()` throw-and-exit pattern in `register-agent/get/delete/list/info/credits/login`.
- `bounty auth login --agent-address` also soft-auth: works even before token exists.

**3️⃣ Input tolerance** (missing optional fields → no error, type mismatch → friendly error + exit 2):

- `bounty bounty-task publish`: missing optional fields (`tags`, `deadline`, `description-file`, `description`) → client omits them; only required (`title`, `type`, `reward`) enforced.
- New `validatePublishInput()` helper — type mismatch (e.g., `reward=abc`, `tags=not-array`) → friendly console error + `process.exit(2)`.
- All bounty-task subcommands now use soft auth consistently.

**4️⃣ Test coverage** (+19 tests):

- `tests/cli/address-parser.test.ts` — 8 tests for `parseAgentAddress` + `resolveAgentIdOption`.
- `tests/cli/soft-auth.test.ts` — 6 tests for `attachSoftAuth` (no-throw on missing token).
- `tests/cli/input-validator.test.ts` — 5 tests for `validatePublishInput` (missing optional fields, type mismatch).
- All new helpers exported from `src/cli/lib/index.ts`.

**5️⃣ Backward compatibility**:

- `--publisher-id` / `--agent-id` numeric flags still work (deprecation warning).
- `BOUNTY_IM_ADDRESS` may be either `uuid@host` (preferred) or pure `uuid` (legacy).
- `bounty auth login` no longer requires pre-existing token (soft auth).

### Stats
- Commits ahead of main: **4** (df8721c, fdb3f86, 05506a7, 134869e)
- Tests: **537+ pass, 0 fail** (baseline 518, +19 new helper tests + integration coverage)
- Files changed: ~12 source files (helpers + 12 command files) + 4 test files
- Coordination: web 端 (8de9b6aa) handles server-side address support + K8s deploy.

## [0.6.0] - 2026-07-10

### Added (bounty-task CLI v0.6 — feat/bounty-task-optimize)
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