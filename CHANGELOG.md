## [v0.14.2] - 2026-07-18 - Server-Side Self-Echo Prevention (PATCH)

> **Server-side root-cause fix** — closes the WS self-echo loop observed in
> v0.14.1. Companion fix to the `roy-agent` client-side self-echo filter
> (Task #2136). Together they ensure an agent never sees their own
> outbound messages as inbound events.

### Fixed

- **`POST /api/messages` self-message rejection (HTTP 400)**: when the
  recipient resolves to the same UUID as the authenticated sender,
  return `400 { code: "SELF_MESSAGE_NOT_ALLOWED" }`. Closes the
  observable bug where `bounty com send -F X -T X` (and any program
  using `to_email = <self>`) pushed the outbound message back to the
  sender's own WS connection with `fromEmail == toEmail`.

- **`POST /api/messages` unregistered recipient rejection (HTTP 404)**:
  when the wired resolver (`findAgentByEmailOrAddress`) cannot map the
  recipient email to a registered agent, return
  `404 { code: "RECIPIENT_NOT_FOUND" }`. Surfaces wrong-address errors
  early instead of silently storing the message in a phantom inbox.

- **WS push defense-in-depth** in `BountyHTTPServer.pushMessage`:
  compares the connection's registered UUID against the message's
  `from` UUID; matching UUIDs skip the WS send (`return false`). Catches
  the legacy WS `message` event path that doesn't go through
  `IMRoutes.sendMessage`.

- **`handleWsMessage` 'message' case**: now delegates to `pushMessage`
  instead of calling `client.socket.send` directly, so both push paths
  share the same self-echo guard.

### Compatibility (BREAKING for one edge case)

- The CLI previously sent `bounty com send -F X -T X` successfully
  (server stored the message and pushed back). v0.14.2 returns HTTP 400
  on this input — the CLI surfaces a clear error and the message is not
  stored. Run with two different emails instead.
- Unregistered recipients now return 404 instead of silently accepting
  the message. The server-side `messages.to_address` row is no longer
  populated with raw emails for unknown identifiers.

### Tests

- 5 new tests covering: sender != recipient WS push, self-message 400,
  unregistered 404, WS message-event self-skip, v0.14.1 enrichment
  preserved on happy path.
- 6 existing tests updated to assert the new contract (T3 + T4 of
  `im-routes-send-canonical`, T4 of `im-routes-v0.14.1-email-display`,
  T3 of `ws-push-v0.14.1-email-display`, tests 1 + 3 + 4 of
  `im-routes-sender-identity`).
- Baseline 1043 → 1048 pass, 0 regressions.

---

## [v0.14.1] - 2026-07-18 - Email Display Surface (PATCH)

> **Display-only patch** — no API contract changes, no CLI flag changes.
> Fixes the user-facing problem that `bounty com send` / `bounty com inbox`
> showed the canonical `<uuid>@authenticated` instead of the registered
> email. Companion fix for the `roy-agent` event source so the LLM sees
> `gddzhaokun@126.com` instead of `767a3275-...@authenticated`.

### Added

- **HTTP response enrichment**: `POST /api/messages` and `GET /api/messages`
  responses now include `from_email` / `to_email` (registered emails)
  alongside the canonical `from` / `to` storage fields.
- **WS push payload enrichment**: WebSocket pushes include `fromEmail` /
  `toEmail` so receiving agents can surface the registered email in the
  LLM-visible message.
- **Resolver**: server wires an `agents`-table-aware resolver that handles
  three input shapes:
  1. `<uuid>@authenticated` → strip suffix, look up by `agents.id`
  2. `<uuid>@<host>` → look up by `agents.address`
  3. bare email → look up by `agents.email`

### CLI behaviour

- `bounty com send` response display: `From:` / `To:` now show registered
  email (`message.from_email ?? message.from`); canonical falls back when
  the server predates v0.14.1.
- `bounty com inbox` items: same enrichment (`msg.from_email ?? msg.from`).

### Compatibility

- Canonical `from` / `to` fields are unchanged (storage format preserved).
- v0.14.0 servers (without enrichment) still work — CLI gracefully falls
  back to canonical display.

### Tests

- 13 new tests covering: POST /api/messages response enrichment, inbox
  enrichment, resolver wiring, CLI display fallback, WS push enrichment.
- Baseline 917 → 930 pass, 0 regressions.

---

## [v0.14.0] - 2026-07-17 - Strict Email-Only Refactor (BREAKING MINOR)

> **🚨 BREAKING**: This release deletes every CLI flag and HTTP body field that
> accepted `<uuid>@<host>` or bare UUID actor identity. The ONLY actor identity
> input is now the **registered email** (e.g. `alice@example.com`).
>
> Migration: see "[Migration from v0.13.x](#migration-from-v013x)" below.

### Changed (BREAKING)

- **Every CLI flag that named an actor now accepts ONLY email**:
  - `bounty bounty-task { grab, submit, complete, cancel }`: `--email` ONLY.
    `--agent-address / -a`, `--agent-id` REMOVED.
  - `bounty bounty-task { publish }`: `--publisher-email / -e` ONLY.
    `--publisher-address / -p`, `--publisher-id` REMOVED.
  - `bounty bounty-task board`: optional `--publisher-email / -e`
    filter (translates to `?publisherId=<email>` on the wire).
  - `bounty com { send }`: `--from-email / -F` and `--to-email / -T` ONLY.
    `--from`, `--to`, `--from / -f`, `--to / -t` REMOVED entirely
    (not even as opt-in flags). `--server-url` alias renamed from
    `e` to `u` (Decision Q6).
  - `bounty com { inbox, connect, disconnect }`: `--email / -E` ONLY.
    `--address`, `--agent-id` REMOVED.
  - `bounty auth login`: `--email / -e` ONLY. `--agent-address`, `--agent-id` REMOVED.
  - `bounty register-agent { login, get, delete, info, credits }`:
    `--email / -e` ONLY. `--agent-address`, `--agent-id`, `--id / -i` REMOVED.
  - `bounty profile add`: `--email / -e` ONLY. `--agent-id` REMOVED.

### Removed (BREAKING)

- `BOUNTY_IM_ADDRESS` environment variable — implicit fallback that
  introduced silent-misrouting is GONE. Use `bounty profile use <name>`
  to set active identity, then explicitly register the `bounty-im`
  EventSource if needed.
- Auto-registration of `bounty-im` EventSource in `src/cli/cli.ts` at
  session start (Q5 ✅ DELETE).
- `--server-url / -e` alias on `com send` (Q6) — `--server-url / -u`
  is the new alias. Long form `--server-url` unchanged.

### Internal contract

- Decision Q1 ✅: `agents.address` column KEEPS its `<uuid>@<host>`
  internal canonical form (for IM routing / FK joins). It is no longer
  accepted as input shape.
- Decision Q2 ✅: lookup API `GET /api/agents/by-email?email=<email>`
  unchanged.
- Decision Q3 ✅: server returns **404 Not Found** on valid-format
  but unregistered email; **400 Bad Request** on malformed input.
- Decision Q4 ✅: `messages.from_address` / `messages.to_address`
  store canonical `<uuid>@<host>` server-side; clients see only email.

### Migration from v0.13.x

1. Find every shell script / cron job / agent that passes
   `--agent-address` / `--publisher-address` / `--from` / `--to` /
   `<uuid>@<host>` literals and replace with the corresponding
   `--email` or `--from-email` / `--to-email`.
2. Find every shell that exports `BOUNTY_IM_ADDRESS` (any agent
   auto-registration pattern). Replace with `bounty profile add <name>
   --email <email> --api-base <url> --token <jwt>` then `bounty
   profile use <name>`. The token-less agent profile is fine for
   `--email`-only commands.
3. If you previously relied on `-e` as the alias for `com send
   --server-url`, switch to `-u` (long form `--server-url` unchanged).
4. Re-run any `bounty task grab` / `submit` / etc with `--email <email>`.

### Upgrade reliability

The strict-email boundary is now centralised in
`src/cli/lib/email-flag.ts` (`requireEmailFlag` helper). All migration
risk lives in *one* module — no scattered updates across 14 commands.

## [v0.13.4] - 2026-07-17 - IM Send Canonical Address (PATCH)

### Fixed

- **server/im sendMessage**: `messages.to_address` is now stored as
  canonical `<uuid>@<host>` (resolved via `findAgentByEmailOrAddress`)
  when caller passes `to_email=<email>`. Previously the raw email
  string was persisted, causing `com inbox` to return empty results
  because the inbox query path normalizes `?email=` to canonical
  before DB lookup, leading to a key mismatch.

### Behavior

- `to_email=<email>` → resolved to `<uuid>@<host>` before persisting
- `to=<uuid>@<host>` → unchanged (legacy path preserved)
- Unknown recipient → fallback to raw input (no silent message loss)

## [v0.13.3] - 2026-07-17 - Inbox URL Path Fix (PATCH)

### Fixed

- **cli/com inbox**: URL path now uses `/api/messages?email=...` (was `/messages?email=...`).
  The missing `/api` prefix caused the CLI to hit k8s nginx ingress SPA
  HTML fallback when `baseUrl` resolved to the production hostname
  (e.g. via profile.api_base), resulting in "Failed to parse JSON" errors.

## [v0.13.2] - 2026-07-17 - Inbox Bugfixes (PATCH)

### Fixed

- **server/im inbox**: `GET /api/messages?email=...` now resolves via
  `findAgentByEmailOrAddress` to canonical `<uuid>@<host>` before
  ownership check (was returning 403 Forbidden for all email queries).
- **cli/com inbox**: now attaches `Authorization: Bearer <jwt>` from
  active ProfileContext (was 401 due to missing auth header).

### Backward compatibility

- `GET /api/messages?address=<uuid>@<host>` still works unchanged.

# Changelog

All notable changes to ai-agent-bounty are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v0.13.1] - com/* Profile-Aware API Base (Patch)

### Summary

v0.13.1 is a **patch release** that fixes a v0.13.0 regression in the `com/*`
CLI commands (`send`, `inbox`, `connect`, `disconnect`): they ignored the
active profile's `api_base` when `--server-url` was not passed and silently
fell back to `http://${host}:${port}/messages`. This forced users to either
manually pass `--server-url` or rely on the legacy default fallback,
behaving inconsistently with `auth/*`, `register-agent/*`, and
`bounty-task/*` commands.

### Fixed

- **`bounty com send`**: now reads `profile.api_base` from `ProfileContext`
  when `--server-url` is absent. Priority order:
  `--server-url` > `profile.api_base` > `http://${host}:${port}`.
- **`bounty com inbox`**: same wiring — `profile.api_base` wins over the
  legacy host/port fallback.
- **`bounty com connect`**: WebSocket probe now resolves through
  `profile.api_base` (with `http→ws` scheme swap), matching `send`/`inbox`.
- **`bounty com disconnect`**: no network call, but now wires
  `ProfileContext` so the active profile name is reflected in the stub
  notice for consistency.
- **`ProfileContext.getApiBase()`**: changed return type from `string`
  (throwing) to `string | undefined`. No real callers depended on the
  throwing behavior — all callers (`auth/*`, `register-agent/*`,
  `bounty-task/*`) already gate on `profile?.api_base` via
  `resolveProfileApiBase`.

### Backward compatibility

- All `--server-url` and `--host/--port` paths retain their existing
  semantics. No CLI surface changes.
- The legacy `--host`/`--port` fallback (`http://${host}:${port}/messages`)
  is preserved for users with no active profile.

### Tests

- New `tests/cli/v0.13.1-com-profile-api-base.test.ts` with 16 tests
  (5 send + 5 inbox + 4 connect + 2 disconnect), covering:
  - Profile-aware URL construction (static + integration)
  - `--server-url` overrides profile (priority test)
  - Host/port fallback when no profile (backward-compat test)

## [v0.13.0] - Email-First Identity (BREAKING-friendly)

### Summary

v0.13.0 introduces **email-first agent identity** as the primary lookup key
for server endpoints and CLI commands. The legacy `<uuid>@<host>` address
remains a fully-supported secondary path, so this release is a
**soft-breaking** change: existing scripts continue to work, but new code
should send the agent's registered email.

### Added

- **`findAgentByEmail(db, email)`** server helper in `src/server/lib/address-resolver.ts`
- **`findAgentByEmailOrAddress(db, input)`** server helper — email-first,
  address-fallback resolver
- **`POST /api/messages`** accepts `from_email` / `to_email` body fields
  (in addition to legacy `from` / `to`)
- **`GET /api/messages`** accepts `?email=<addr>` query parameter
  (in addition to legacy `?address=<addr>`)
- **`GET /api/agents/by-email?email=<email>`** — lookup agent by registered email
- **`DELETE /api/agents/by-email?email=<email>`** — delete agent by email
- **`GET /api/agents?email=<email>`** — filter list endpoint by email
- **WebSocket `/ws?email=<email>`** — server resolves email to canonical
  `<uuid>@<host>` address via `findAgentByEmailOrAddress`
- **CLI `--email` flag** on 14 commands:
  - `bounty com send --from-email/-F`, `--to-email/-T`
  - `bounty com inbox --email/-e`
  - `bounty com connect --email/-e`
  - `bounty com disconnect --email/-e`
  - `bounty com addresses --email/-e` (help-time hint)
  - `bounty register-agent credits --email/-e`
  - `bounty register-agent get --email/-e`
  - `bounty register-agent delete --email/-e`
  - `bounty bounty-task grab --email/-e`
  - `bounty bounty-task submit --email/-e`

  Note: `auth login`, `register-agent login`, `register-agent info`,
  `profile add` already accepted `--email` in earlier releases.
- **`normalizeAgentIdentifier(input)`** server helper exported from
  `src/server/http/im-routes.ts` for consistent email/address normalisation
- 21 new server tests (`tests/server/{bounty-routes-email-first,im-routes-email-first,ws-email-upgrade}.test.ts`)
- 21 new CLI tests (`tests/cli/v0.13-email-flags.test.ts`)

### Changed

- **`resolveActor(db, body, field, authId)`** in `src/server/http/bounty-routes.ts`
  now checks `body[${field}Email]` first, then falls back to
  `body[${field}Address]` (the previous v0.10 primary path).
- **Error messages** for `createTask`, `grabTask`, `submitTask`, `completeTask`,
  `cancelTask` updated to mention both `*Email` and `*Address` keys
- **WS upgrade** error message updated to "Missing required parameter:
  email or address (v0.13 email-first)"

### Backward Compatibility

- **All v0.10 / v0.12 CLI commands continue to work**. The legacy
  `--agent-address` / `--from` / `--to` flags still resolve via the
  secondary `findAgentByAddress` path.
- **All pre-v0.13 server requests still work**. Endpoints that previously
  expected `agentAddress` now also accept `agentEmail` (or both).
- **Bare UUID rejection** (v0.10) is unchanged — `agentAddress` still
  must be `<uuid>@<host>`; only the email field is a soft relaxation.

### Migration Guide

**Before (v0.10/v0.12)**:
```bash
bounty bounty-task grab --task-id <uuid> \
  --agent-address 8de9b6aa-5781-4000-8000-000000000001@bounty.local
```

**After (v0.13.0 — preferred)**:
```bash
bounty bounty-task grab --task-id <uuid> \
  --email alice@example.com
```

The legacy form continues to work — migration can be done incrementally.

### Breaking Changes

🟡 **Soft-breaking**: error messages for missing identity fields now mention
`--email` (v0.13) before `--agent-address` (legacy). Any caller that
matched on the previous wording (e.g. "agentAddress required") should be
updated to also accept the new wording (`agentEmail or agentAddress required`).

🟢 **No hard breaking changes**: existing client code and scripts continue
to function without modification.

---

## [Unreleased] - Profile 机制 (PR1-PR6)


### Added

- **`bounty profile` 命令组**：完整 profile 管理（add / list / show / use / remove / rename）
- **全局 `--profile / -P` 选项**：所有 CLI 命令支持 profile 切换
- **`BOUNTY_PROFILE` 环境变量**：作为 profile 兜底
- **Profile 文件机制**：每个 profile 一个 JSON 文件，atomic write
- **Token 迁移**：旧 `~/.config/bounty/token` 自动迁移到 `default` profile
- **`bounty auth refresh` 命令**：用 refresh_token 续期
- **`--help` 分组**：Quickstart / Bounty / General 三段式 + `--all` 兼容
- **`BOUNTY_WS_AUTH_REQUIRED` feature flag**：WebSocket 鉴权（默认 false，保守）
- **`docs/profile-guide.md`**：完整使用指南

### Changed

- **HTTP token 鉴权默认开启**（`BOUNTY_TOKEN_CHECK_ENABLED` 默认 `true`）
- **6 个 auth 命令改造**：使用 ProfileContext 和 profile.api_base
- **认证体验统一**：所有命令的鉴权走同一套 ProfileContext

### Breaking Changes

- 🔴 **`BOUNTY_TOKEN` 环境变量移除**：所有 token 配置必须通过 profile 文件
  ```bash
  # 旧（已不支持）
  export BOUNTY_TOKEN=xxx
  bounty task list

  # 新
  bounty auth login  # 登录到当前 profile
  ```
- 🟡 **Server 默认 token 鉴权开启**：自建 server 不再接受未鉴权请求（除白名单）

### Migration

```bash
# 从 v0.10 升级
bun install -g @ai-setting/agent-bounty@latest

# 首次运行自动迁移旧 token
bounty auth status  # 自动迁移 ~/.config/bounty/token 到 default profile

# 验证
bounty profile list  # 应该看到 default
bounty profile show  # token 已脱敏显示
```


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