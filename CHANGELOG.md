# Changelog

All notable changes to ai-agent-bounty are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [v0.10.1] - 2026-07-12 — Standalone binary rebuild

### Fixed

- `@ai-setting/agent-bounty-standalone@0.10.0` 包内 4 个平台二进制（linux-x64, linux-arm64, darwin-x64, darwin-arm64）构建于 v0.10.0 commit (`cdd4714`) **之前**，导致独立二进制缺少 v0.10.0 BREAKING address-unification 的所有 flag 变更（仍保留 `--publisher-id` / `--agent-id`，不接受 `--*-address` 完整格式）。
- **0.10.0 npm release 已 `npm deprecate`**：`Broken release: stale binaries pre-date v0.10.0 address-unification commit. Use 0.10.1+`
- 0.10.1 重新构建 4 个平台二进制 + 验证 `--agent-id` / `--publisher-id` UNKNOWN + `--publisher-address` STRICT uuid@host 校验生效

### Migration

```bash
# 不需要改代码，只需 bump 安装版本
npm install -g @ai-setting/agent-bounty-standalone@0.10.1

# 不再 pin 0.10.0（已 deprecated）
```

## [v0.10.0] - 2026-07-12 — Address Unification (BREAKING)

### ⚠️ BREAKING CHANGES

**所有 address 参数强制 `<uuid>@<host>` 格式**。Bare UUID、email-like、空
字符串、多 `@` 字符一律 REJECTED。

#### Removed flags

| 旧 flag (v0.9) | 新 flag (v0.10) |
|---|---|
| `--publisher-id` | `--publisher-address <uuid>@<host>` |
| `--agent-id` | `--agent-address <uuid>@<host>` |
| `--id` (-i) on `register-agent/{get,delete,info,credits}` | `--agent-address` (无 -i) |
| `BOUNTY_IM_ADDRESS=agent-uuid` (bare) | `BOUNTY_IM_ADDRESS=<uuid>@<host>` |

#### Server contract change

旧 `resolveActor` 优先级链（v0.7-v0.9）：`body[*Address]` → `body[*Id]` → `authId`
新 `resolveActor` 优先级链（v0.10）：`body[*Address]` → `authId`（`body[*Id]` 已移除）

- 客户端 `body[*Address]` 现在 MUST 是完整 `<uuid>@<host>`（以前可裸 uuid）
- 服务器 `body[*Id]` 字段已不再被读取
- 错误信息：`publisherAddress required (<uuid>@<host>)` / `agentAddress required (<uuid>@<host>)`

### Added

- **`src/lib/address.ts`** — 共享 strict 解析层（102 行，CLI/server 共享）
  - `parseAddress(input, field)` 严格模式（RFC 4122 v1-v5 UUID + 主机名 labels 校验）
  - `formatAddress(uuid, host)` 工具函数
  - `isValidAddress(input)` 简写

- **`src/cli/lib/address-parser.ts`** 新 `resolveAddressOption` helper
  - 替换旧 `resolveAgentIdOption`
  - 返回完整 `{ uuid, host, raw }` 三元组（而非仅 uuid）
  - 接收 string 或 Address object 作为 fallback

- **`src/cli/lib/current-agent.ts`** 新 `resolveCurrentAgentAddress()`
  - 返回完整 Address（env 必须是 `<uuid>@<host>`）

### Changed

- **`src/server/lib/address-resolver.ts`** — 强化为 strict（移除 bare UUID 兼容）
- **`src/server/http/bounty-routes.ts`** — `resolveActor` 移除 `${field}Id` 分支
- 7 个 CLI 命令移除 `--*-id` flag、发送完整 address：
  - `bounty-task/{publish,grab,submit,complete,cancel}.ts`
  - `auth/login.ts`, `register-agent/{login,get,delete,info,credits}.ts`
- `X-Agent-Id` header 仍 = bare uuid（soft-auth 向后兼容）
- 测试套件：43 个新增 strict cases（src/lib/address 22 + cli helper 11 + 集成 10）

### Upgrade guide

```bash
# Before (v0.9)
bounty bounty-task publish -t "x" -y coding -r 100 \
  --publisher-id ee0dd085-0b66-4640-81bc-f8d4c743c1e6

# After (v0.10)
bounty bounty-task publish -t "x" -y coding -r 100 \
  --publisher-address ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.local
```

- `BOUNTY_IM_ADDRESS` 环境变量也必须升级
- 旧脚本搜索替换：`--publisher-id` → `--publisher-address`，`--agent-id` → `--agent-address`
- 然后给每个 UUID 后面补上 `@<host>`（host 可从 server 的 `BOUNTY_DOMAIN` env 取）

### Tests / Verification

- 657 tests / 1855 expects — all green
- `bunx tsc --noEmit` — 0 errors
- `bun run build` — 4 bundles success
- 设计文档：`docs/refactor/address-unification.md`

## [v0.9.0] - 2026-07-12

### Documentation / Audit

- **Bounty + IM token policy audit (v0.9)**: review of `BOUNTY_TOKEN_CHECK_ENABLED`
  handling across `BountyRoutes` (publish/grab/submit/complete/cancel/dispute) and
  `IMRoutes` (send/ack/inbox). Audit confirmed both route groups share an **identical**
  policy wired through the single `BountyHTTPServer.checkAuth` gate:
    - Default (env unset / `false` / `0`): `Authorization` header is **optional**;
      `agentId` in handlers stays `undefined`, callers must supply `*Address` in body.
    - `BOUNTY_TOKEN_CHECK_ENABLED=true|1`: `Authorization: Bearer <jwt>` is required;
      missing header → 401; bad token → 401; valid token → `agentId = payload.sub`.
  No code-level drift found. The only material improvement is **discoverability**:
    - `.env.example` now documents `BOUNTY_TOKEN_CHECK_ENABLED` with the unified
      contract (applies to `/api/tasks/*`, `/api/messages/*`, `/api/agents/*`).
  TDD coverage added: `tests/server/token-policy-consistency.test.ts` (+8 cases:
  bounty-publish ok/no-token, IM-send ok/no-token, bounty-grab ok/no-token,
  bounty-publish → 401, IM-send → 401, bounty-grab → 401, bad-token → 401 across
  both route groups, env state isolation between server instances). Combined with
  pre-existing `tests/server/{token-check-toggle,soft-auth-no-header-grab,
  im-routes-auth,bounty-routes-address,bounty-routes-service}.test.ts`, the
  consistency contract is now locked.
- **No production code change** — single-file addition is `tests/...consistency.test.ts`
  and a documentation block in `.env.example`. Behaviour-equivalent refactor.

### Notes

- Audit was performed against commit `a3230c8` (v0.8.0) and verified on the new tests.
- Resulting strategy: keep `BOUNTY_TOKEN_CHECK_ENABLED` as the single source of truth
  for ALL `/api/*` routes. Future route additions must call `checkAuth()` so the
  toggle remains authoritative — see `src/server/http/index.ts:handleRequest`.

## [0.9.0] - 2026-07-12

### Documentation / Audit

- Promoted the `[Unreleased]` v0.9 audit entry to a real release. See the
  audit notes above (lines above `[0.8.0]`) for the full contract spec and
  TDD coverage list. No production-code diff between v0.8.0 and v0.9.0 —
  v0.9.0 is a documentation + test-coverage release that locks the
  `BOUNTY_TOKEN_CHECK_ENABLED` consistency claim between bounty and IM routes.

## [0.8.0] - 2026-07-11

### Fixed

- **IM sender identity (HTTP `/im/messages`)**: do not pass `{ agentId: undefined }` to
  `imRoutes.sendMessage`. When `BOUNTY_TOKEN_CHECK_ENABLED=false` and no `Authorization`
  header is sent, the requester object is now `undefined` so `sendMessage` falls through
  to its legacy `body.from` path without ambiguity. Previously the route always forwarded
  a `{ agentId: undefined }` object, which downstream code interpreted as "authenticated
  user with id undefined" and overrode the client's `body.from` with an undefined sender.
  TDD coverage: `tests/server/im-routes-sender-identity.test.ts` (+4 cases: no-auth+off,
  no-auth+on→401, valid-auth, contract-lock spy asserting `sendMessage` is called WITHOUT
  a requester arg when `tokenCheckOff`).

### Notes

- Single-file fix in `src/server/http/index.ts` (+10/-1). Pure semantic regression —
  no API or behaviour change for authenticated callers.
- Branch merged: `fix/im-send-from-identity` → `main` (merge commit `405ced4`).

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