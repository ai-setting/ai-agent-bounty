# [v0.14.0] Strict Email-Only Input Refactor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make **registered email the only acceptable input** across the entire ai-agent-bounty surface (CLI flags + Server HTTP endpoints + WS payload). Strip out every legacy `<uuid>@<host>` / bare-UUID / `--agent-address` / `--publisher-address` / `--id` / `--agent-id` / `BOUNTY_IM_ADDRESS` fallback path so the API becomes opinionated, unambiguous and impossible to mis-route.

**Architecture:** Two-phase refactor — (1) flip each entry point from "email OR address" to "email ONLY" at the boundary, keeping the canonical IM routing form (`<uuid>@<host>`) inside storage and routing; (2) delete the address parsers / dual-path branches that have only existed to bridge the v0.12 / v0.13 era. Each phase is RED → GREEN → REFACTOR with one CLI or endpoint at a time.

**Tech Stack:** Bun 1.3+, TypeScript 5.3, `bun:sqlite`, `yargs`, existing `findAgentByEmailOrAddress` resolver, `chalk`, `zod`.

**Auto-merge:** `false`. Final stop is `refactor/bounty-email-only`. User must explicitly approve merge to `main`.

**Version bump:** v0.13.4 → **v0.14.0** (BREAKING MINOR). CHANGELOG and `package.json` both bumped.

---

## Why This Exists (Context)

This is the strict successor to parent task **#2103** (v0.13.0 "add email, keep `uuid@host` as secondary"). v0.13.0 / v0.13.4 added `--email` / `--from-email` / `--to-email` / `body.*Email` everywhere but kept a parallel `*Address` / `*Id` path as a "backward-compat crutch". In production this crutch has caused:

1. **Cascading fallback code paths** — every endpoint has an `email → address → authId` cascade, every CLI command has `email → address → BOUNTY_IM_ADDRESS` cascading parser. Each branch has subtle bugs (see v0.13.4 IM canonicalization fix).
2. **Auth-impersonation surface** — bare UUIDs / `<uuid>@<host>` strings can still be sent and resolved without the caller knowing the registered email. Even if the v0.10 strict parser rejects bare UUIDs, the dual-path lets `body.agentAddress` carry the same identity as `body.agentEmail`, so a misuse where one is email-shaped and one is address-shaped is now silently accepted.
3. **WS payload ambiguity** — `messages.from/to` columns store canonical `<uuid>@<host>` (required for IM routing). Clients have to know the difference between input shape and storage shape. v0.14 eliminates the input-shape ambiguity.

The v0.14 contract is simple:

> Every CLI flag and every HTTP body that names an actor must accept ONLY the actor's **registered email**. The server MAY resolve that email to an internal `<uuid>@<host>` canonical id for IM routing / DB writes, but the input shape is **always** RFC-ish email.

---

## 保留什么 / 移除什么 / 重写什么（refactor 三段分解）

### ✅ 保留什么 (Keep — 已有能力全数保留)

| 资产 | 说明 |
|---|---|
| `agents.email` column + `agents.email UNIQUE` index | PRIMARY identity column for the v0.14 contract |
| `agents.address` column (`<uuid>@<host>`) | **Internal canonical id** for IM routing, WS push, `messages.to_address` storage, foreign-key joins. **Input shape is no longer agent-address**, but the column survives because it IS the canonical primary key in the IM model. *(Decision Q1 ✅ KEEP — see Decision Record.)* |
| DB schema: `agents.address` → `tasks.publisher_id` / `tasks.assignee_id` joins | Stable; FK to `agents.id` is the underlying primary key |
| Server endpoint paths (`POST /api/tasks`, `PUT /api/tasks/:id/grab`, `POST /api/messages`, …) | URLs stable; only request body / query fields change |
| `findAgentByEmail` resolver in `src/server/lib/address-resolver.ts` | Sole resolver; other helpers deleted (see 删除什么) |
| `agents.address` ↔ IM `from/to` routing conversion inside server | Internal-only; not exposed in input |
| IM DB tables (`messages.from_address`, `messages.to_address`) | Continue to hold canonical `<uuid>@<host>` strings (Decision Q4) |
| CLI `/scripts/` wrapper conventions (yargs pattern, `--server-url` override, profile resolution) | All non-identity flags/options untouched |
| Profile mechanism (PR1–PR7): `ProfileContext`, `~/.config/bounty/profiles/`, `BOUNTY_PROFILE` env | All identity-bearing commands still resolve through ProfileContext, but the **identity field** is now `email` exclusively |
| `BOUNTY_TOKEN_CHECK_ENABLED` server flag | Unchanged; JWT-based auth still works with `sub = agent.id` |

### ❌ 移除什么 (Remove — no replacement)

| 删除对象 | 文件 / 位置 |
|---|---|
| `--agent-address / -a` flag in **all 13 bounty/cli commands** | `src/cli/commands/{bounty-task,com,register-agent,auth,profile}/*.ts` — see CLI table below |
| `--publisher-address / -p`, `--from`, `--to`, `--from/-f`, `--to/-t`, `--address / -a` (com/mail), `--id / -i`, `--agent-id / -a` (com/addresses, profile/add) | Same CLI surface as above |
| `BOUNTY_IM_ADDRESS` env variable fallback in CLI resolver | `src/cli/lib/current-agent.ts` — both `resolveCurrentAgent` and `resolveCurrentAgentAddress` are deleted; CLI commands that needed a default look up the **active profile's `email`** instead |
| `resolveCurrentAgentAddress()` helper | `src/cli/lib/current-agent.ts` — deleted |
| `Address` type + `parseAddress` / `parseAgentAddress` / `formatAddress` / `isValidAddress` exports | `src/lib/address.ts` + `src/cli/lib/address-parser.ts` — deleted. `parseEmail` is the new helper (see 重写什么) |
| `findAgentByAddress(db, input)` resolver | `src/server/lib/address-resolver.ts` — deleted |
| `AddressParts` type, `EMAIL_RE` constant (resolver-internal usage) | `src/server/lib/address-resolver.ts` — deleted |
| Address-form fallback in `AgentService.findByAddress(input)` | `src/lib/agent/index.ts` — deleted |
| `body.publisherAddress` / `body.agentAddress` body fields in all bounty endpoints | `src/server/http/bounty-routes.ts` — `resolveActor()` only reads `body[*Email]` and JWT `authId` |
| `?address=<uuid>@<host>` query param in IM routes (`GET /api/messages`, `ws?address=`) | `src/server/http/im-routes.ts` — only `?email=` survives |
| Legacy `from` / `to` (no suffix) body fields in `POST /api/messages` | `src/server/http/im-routes.ts` — only `from_email` / `to_email` survive |
| `agent_id` body field in `POST /api/auth/login` | `src/server/http/auth-routes.ts` — only `email` survives |
| `address` optional field in `POST /api/auth/register` | `src/server/http/auth-routes.ts` — server generates `<uuid>@<host>` internally; clients cannot pre-claim an address |
| Test fixtures / v0.13 dual-path tests | `tests/cli/v0.13-email-flags.test.ts` becomes **v0.14-email-only.test.ts**; removed `address-parser.test.ts`, `address-format-cli.test.ts`, `bounty-task-default-agent.test.ts` (BOUNTY_IM_ADDRESS cases) |
| CHANGELOG entries mentioning `<uuid>@<host>` as user input | `CHANGELOG.md` — revised |
| Help text mentioning `--agent-address`, `--publisher-address`, `--from`, `--to`, `--address`, `--id`, `--agent-id`, `<uuid>@<host>`, `BOUNTY_IM_ADDRESS` | All CLI `.ts` files + `src/lib/mail/bounty-constants.ts` |

### 🔧 重写什么 (Rewrite — same intent, new shape)

| 重写对象 | 新形态 |
|---|---|
| `src/lib/address.ts` (whole module) | Replaced by `src/lib/email-resolver.ts`: `parseEmail(input, field)` strict RFC-5322-ish regex; `findAgentByEmail(db, email)` is the sole server resolver; `formatCanonicalAddress(uuid, host)` retained only as internal helper for IM push. |
| `src/server/lib/address-resolver.ts` (whole module) | Replaced by `src/server/email-resolver.ts`: `findAgentByEmail(db, email) → { id, email, canonicalAddress }` only. `findAgentByEmailOrAddress` deleted. |
| `src/server/http/bounty-routes.ts::resolveActor()` | Reads `body.publisherEmail` / `body.agentEmail` only. Falls back to JWT-derived `authId`. Server **always** validates email format first; unknown email → 404 Not Found. |
| `src/server/http/im-routes.ts::sendMessage()` | Body contract is `from_email` / `to_email` only. Resolves to canonical id internally and stores in `messages.from_address` / `messages.to_address`. (Decision Q4.) |
| `src/server/http/im-routes.ts::getMessages()` | `?email=` is the only accepted query param. `?address=` removed. |
| `src/server/http/auth-routes.ts::login()` | Body is `{ email: string }` only. UUID lookup is removed. |
| `src/server/http/auth-routes.ts::register()` | Body is `{ email, name, description? }` — no `address` field accepted. |
| `src/cli/lib/current-agent.ts` | Resolves active profile's email from `ProfileContext.getActive().email`. **No env-based fallback.** If no profile is active or profile has no `email`, CLI exits with `bounty-task: missing email — run \`bounty profile add <name> --email <email>\` and \`bounty profile use <name>\`` message and code 2. |
| Each of the 14 CLI commands (table below) | Single `--email` (or `--from-email`/`--to-email` for send) flag. No address flags. No agent-id. No env fallback. |
| `src/cli/commands/profile/add.ts` `--agent-id / -a` flag | Removed. `--email` is the only identity field stored in `BountyProfile`. (`agent_id` field stays in profile JSON for legacy profile migration but is no longer settable via CLI; it's auto-resolved server-side from email.) |
| `bounty-task/publish.ts` | Adds `--email / -e` for publisher identity; removes `--publisher-address`. Sends `body.publisherEmail`. |
| `bounty-task/board.ts` filters | `?publisherId=` is interpreted as email string for filtering (server resolves email→uuid internally). |
| `src/cli/commands/com/addresses.ts` | Stub now prints ONLY the email format docs and the agent's email (from ProfileContext). Removes `agent-id` placeholder. |
| Tests | `tests/server/bounty-routes-email-first.test.ts` becomes `bounty-routes-email-only.test.ts` asserting 400 on malformed input, 404 on valid-but-unknown, and 200/201/409 only on registered email. |
| `package.json` version | `0.13.4` → `0.14.0` |
| `CHANGELOG.md` | New `## [v0.14.0] - 2026-XX-XX - Strict Email-Only Contract (BREAKING MINOR)` section; marks every v0.13 dual-path fallback as REMOVED. |

### 📋 CLI command refactor matrix (14 commands)

| Command file | v0.13 flags | v0.14 flags (final) |
|---|---|---|
| `src/cli/commands/com/send.ts` | `--from`, `--from-email`, `--to`, `--to-email` | `--from-email / -F`, `--to-email / -T` only |
| `src/cli/commands/com/inbox.ts` | `--email`, `--address` | `--email / -e` only |
| `src/cli/commands/com/connect.ts` | `--email`, `--address` | `--email / -e` only |
| `src/cli/commands/com/disconnect.ts` | `--email`, `--address` | `--email / -e` only |
| `src/cli/commands/com/addresses.ts` | `--agent-id`, `--email` | `--email / -e` only (email printed from profile) |
| `src/cli/commands/auth/login.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/register-agent/credits.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/register-agent/get.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/register-agent/delete.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/register-agent/login.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/register-agent/info.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/profile/add.ts` | `--agent-id`, `--email` | `--email / -e` only; remove `--agent-id / -a` |
| `src/cli/commands/bounty-task/grab.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/bounty-task/submit.ts` | `--email`, `--agent-address` | `--email / -e` only |
| `src/cli/commands/bounty-task/publish.ts` | `--publisher-address` | `--publisher-email / -e` only |
| `src/cli/commands/bounty-task/board.ts` | (none, query params) | Query params: `?publisherId=<email>` only |
| `src/cli/commands/bounty-task/complete.ts` | `--publisher-address` | `--publisher-email / -e` only |
| `src/cli/commands/bounty-task/cancel.ts` | `--publisher-address` | `--publisher-email / -e` only |

(All alias conflicts with existing `-e`, `-E`, `-H`, `-p`, `-u`, `-k` are unchanged — `-e` continues to mean `--email`. The historical `--server-url / -e` flag in `com/send.ts` is preserved but **re-aliased to `-u`** in v0.14 to make room for the new `--from-email / -F` and `--to-email / -T` defaults.)

> **✅ Decision point Q6 (resolved 2026-07-17):** `--server-url` is **re-aliased to `-u`** (away from `-e`) across **all** consumer commands, including `com/send.ts`. Rationale: `-e` is reserved for `--email` / `--from-email` etc. across `auth/*`, `register-agent/*`, `bounty-task/*`; yargs alias collisions would merge values into arrays and silently break the strict-email contract. `addServerUrlOption` helper in `src/cli/lib/server-url-option.ts` already standardizes `-u` for `com/{inbox,connect,disconnect}.ts`; the only outlier is `com/send.ts` (still has `alias: 'e'` for `--server-url`). TDD repair plan R-3 below brings `send.ts` into line and is part of Phase 4 Task 8. CHANGELOG will list this as a v0.14 BREAKING flag-alias rename.

---

## 目标 (Goal)

1. **Single input shape across the entire surface.** Every CLI flag and every HTTP body that names an actor accepts ONLY the registered email. No exceptions, no fallbacks, no env reads.
2. **Hard rejection of legacy identifiers.** CLI exits 1 with a clear "use --email <your-registered-email>" message on any `<uuid>@<host>` / bare UUID / `--agent-address` input. Server responds 400 on syntactically-wrong input and **404 on valid-format-but-unregistered** email (Decision Q3).
3. **Storage column stability.** Internal storage (`messages.from_address`, `messages.to_address`, `agents.address`) keeps its canonical form. Email is resolved server-side to canonical id internally; clients never see `<uuid>@<host>`. (Decision Q4.)
4. **BDD/TDD discipline preserved.** Every endpoint / every CLI command has at least one RED test asserting legacy input is rejected, and at least one GREEN test asserting email input works.
5. **Auto-merge disabled.** Branch `refactor/bounty-email-only` is left ready for human review; nothing reaches `main` without explicit approval.

## 验收标准 (Acceptance Criteria — must all pass)

1. `bun run typecheck` exits 0.
2. `bun run test` (default serial) exits 0 with **0 failing** tests. The full CLI + Server suite (currently ~360 tests in `tests/cli/*.test.ts` + `tests/server/*.test.ts`) remains green.
3. `bun run test:fast` (parallel 4) exits 0 — same conditions.
4. `bun run build` produces `dist/cli/*.js`, `dist/bin/bounty.js`, `dist/server/server.js`, `dist/plugin/index.js` — all four artifacts present and exit 0.
5. **RED test set (≥18 failing tests first, all must pass after implementation):**
   - `[RED-1]` `bounty-task/grab.ts` with `--agent-address <uuid>@<host>` → exit 1, "use --email".
   - `[RED-2]` `bounty-task/grab.ts` with `--agent-address <bare-uuid>` → exit 1.
   - `[RED-3]` `bounty-task/submit.ts` with `--agent-address` → exit 1.
   - `[RED-4]` `bounty-task/publish.ts` with `--publisher-address` → exit 1.
   - `[RED-5]` `bounty-task/complete.ts` with `--publisher-address` → exit 1.
   - `[RED-6]` `bounty-task/cancel.ts` with `--publisher-address` → exit 1.
   - `[RED-7]` `com/send.ts` with `--from` / `--to` (without `--from-email` / `--to-email`) → exit 1.
   - `[RED-8]` `com/inbox.ts` with `--address <uuid>@<host>` → exit 1.
   - `[RED-9]` `com/connect.ts` with `--address <uuid>@<host>` → exit 1.
   - `[RED-10]` `com/disconnect.ts` with `--address` → exit 1.
   - `[RED-11]` `com/addresses.ts` with `--agent-id` → exit 1.
   - `[RED-12]` `auth/login.ts` with `--agent-address` → exit 1.
   - `[RED-13]` `register-agent/{info,get,delete,credits,login}.ts` with `--agent-address` → exit 1.
   - `[RED-14]` `profile/add.ts` with `--agent-id` → exit 1.
   - `[RED-15]` Server: `POST /api/tasks` with `body.publisherAddress` → 400 "use publisherEmail".
   - `[RED-16]` Server: `PUT /api/tasks/:id/grab` with `body.agentAddress` → 400.
   - `[RED-17]` Server: `POST /api/messages` with `body.from` (no `from_email`) → 400.
   - `[RED-18]` Server: `POST /api/auth/login` with `body.agent_id` → 400 "use email".
   - `[RED-19]` Server: `POST /api/auth/register` with `body.address` → 400.
   - `[RED-20]` Server: `GET /api/messages?address=<uuid>@<host>` → 400 "use ?email=".
6. **GREEN test set (registered-email path returns 200/201/409 only):**
   - All endpoints return 2xx for a registered email.
   - Unknown email → 404 (Decision Q3).
   - Malformed email (missing `@`, whitespace) → 400.
7. **CLI usage sanity:** `bounty bounty-task grab --help` shows only `--email`, no `--agent-address`. Grep across `src/cli/commands/**` for `--agent-address`, `--publisher-address`, `--from`, `--to`, `--address`, `--agent-id`, `--id`, `<uuid>@<host>`, `BOUNTY_IM_ADDRESS` returns 0 matches in **active flag descriptions** (comments documenting the removal are fine).
8. **Server help:** `src/lib/address.ts`, `src/lib/address-parser.ts`, `parseAgentAddress` (CLI), and `findAgentByAddress` (server) are deleted; `grep -r findAgentByAddress src/` returns 0 matches.
9. **CHANGELOG:** `## [v0.14.0]` section exists, with `### Removed`, `### Changed`, `### Migration` subsections; explicitly lists `--agent-address`, `--publisher-address`, `--from`/`--to`, `--agent-id`, `--id`, `BOUNTY_IM_ADDRESS`, `body.*Address`, `body.agent_id`.
10. **README + docs:** README pinned `v0.14.0` upgrade callout, link to migration section. `docs/superpowers/plans/2026-07-17-bounty-email-only-refactor.md` linked from CHANGELOG.

> **✅ Decision points Q1 / Q2 / Q3 / Q4 / Q5 / Q6 — ALL RESOLVED 2026-07-17 (user-confirmed).** See the **Decision Record** section at the end of this plan for the final answers. Implementation of those sections is unblocked; Phase 4 begins immediately.

## 涉及文件清单 (Files Involved)

### New files (3)

- `src/lib/email-resolver.ts` — single server-side resolver: `parseEmail(input, field)`, `findAgentByEmail(db, email)`, internal `formatCanonicalAddress(uuid, host)` re-export.
- `src/cli/lib/email-flag.ts` — CLI helper `requireEmailFlag(argv)` that exits 1 with a helpful error when neither `--email` nor profile-supplied email is available.
- `tests/server/email-resolver.test.ts` — unit tests for parseEmail + findAgentByEmail.
- `tests/server/bounty-routes-email-only.test.ts` — replaces `bounty-routes-email-first.test.ts`.
- `tests/cli/bounty-cli-email-only.test.ts` — replaces `v0.13-email-flags.test.ts` with the strict no-fallback contract.

### Deleted files / modules (4)

- `src/lib/address.ts` (delete)
- `src/cli/lib/address-parser.ts` (delete)
- `tests/cli/address-parser.test.ts` (delete)
- `tests/cli/address-format-cli.test.ts` (delete)
- `tests/cli/bounty-task-default-agent.test.ts` (delete — only tests `BOUNTY_IM_ADDRESS` fallback path)
- `src/server/lib/address-resolver.ts` (rewrite to `src/server/email-resolver.ts` — the constants `AddressParts` and the `Address` type go with `src/lib/address.ts`)

### Rewritten files (CLI — 18 files)

- `src/cli/commands/bounty-task/grab.ts`
- `src/cli/commands/bounty-task/submit.ts`
- `src/cli/commands/bounty-task/publish.ts`
- `src/cli/commands/bounty-task/complete.ts`
- `src/cli/commands/bounty-task/cancel.ts`
- `src/cli/commands/bounty-task/board.ts`
- `src/cli/commands/com/send.ts` (alias `-e → -u` for `--server-url`)
- `src/cli/commands/com/inbox.ts`
- `src/cli/commands/com/connect.ts`
- `src/cli/commands/com/disconnect.ts`
- `src/cli/commands/com/addresses.ts`
- `src/cli/commands/auth/login.ts`
- `src/cli/commands/register-agent/info.ts`
- `src/cli/commands/register-agent/get.ts`
- `src/cli/commands/register-agent/delete.ts`
- `src/cli/commands/register-agent/credits.ts`
- `src/cli/commands/register-agent/login.ts`
- `src/cli/commands/profile/add.ts`

### Rewritten files (Server — 4 files)

- `src/server/email-resolver.ts` (replaces `src/server/lib/address-resolver.ts`)
- `src/server/http/bounty-routes.ts` (strip `*Address` paths, use `findAgentByEmail` only)
- `src/server/http/im-routes.ts` (strip `body.from` / `body.to` and `?address=` paths)
- `src/server/http/auth-routes.ts` (strip `agent_id`, strip `address`)
- `src/lib/agent/index.ts` (delete `findByAddress()`; only `getById` / `getByEmail` remain)

### Rewritten files (helpers — 3 files)

- `src/cli/lib/current-agent.ts` (resolves from active profile only; no `BOUNTY_IM_ADDRESS`)
- `src/lib/mail/bounty-constants.ts` (delete every reference to UUID/uuid@host/agent-id/address as CLI input)
- `src/cli/cli.ts` (drop the EventSource registration that reads `BOUNTY_IM_ADDRESS` env — see Decision Q5)

### Docs & meta (4 files)

- `package.json` (version bump `0.13.4 → 0.14.0`, script `prepublishOnly` unchanged)
- `CHANGELOG.md` (new `## [v0.14.0] - 2026-XX-XX - Strict Email-Only Contract (BREAKING MINOR)` section)
- `README.md` (BREAKING callout near top, link to CHANGELOG migration guide)
- `docs/superpowers/plans/2026-07-17-bounty-email-only-refactor.md` (this file; persisted in branch)

## TDD 步骤 (RED → GREEN → REFACTOR)

Each of the 18 CLI commands and 4 server endpoints follows the same TDD pattern. Below is the canonical pattern with **bounty-task/grab** as the worked example. All other tasks follow this template verbatim — no placeholder steps.

### Task 1: CLI flag surface — `bounty-task grab` (RED → GREEN → REFACTOR)

**Files:**
- Modify: `src/cli/commands/bounty-task/grab.ts` (entire file rewritten)
- Test: `tests/cli/bounty-cli-email-only.test.ts` (new file; this task adds `describe("bounty-task grab email-only")`)

- [ ] **Step 1 (RED):** write failing test asserting `--agent-address` triggers exit 1.
  ```ts
  describe("bounty-task grab — email-only v0.14", () => {
    test("--agent-address is REJECTED with exit 1", async () => {
      let exitCode: number | null = null;
      const errSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
        exitCode = code ?? 0;
        return undefined as never;
      }) as any);
      try {
        const { grabCommand } = await import("@/cli/commands/bounty-task/grab.js");
        await (grabCommand as any).handler({
          "agent-address": "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
          "task-id": "8de9b6aa-5781-4000-8000-000000000099",
          "server-url": "http://localhost:1",
        });
      } finally {
        exitSpy.mockRestore();
        errSpy.mockRestore();
      }
      expect(exitCode).toBe(1);
      expect(errSpy.mock.calls.some(c => /use --email/.test(String(c[0])))).toBe(true);
    });
  });
  ```
- [ ] **Step 2:** Run: `bun test tests/cli/bounty-cli-email-only.test.ts`. **Expected:** FAIL with `expected exit 1, got undefined` (current code only `process.exit(2)` on invalid input but does not reject legacy).
- [ ] **Step 3 (GREEN):** rewrite `grab.ts`:
  - Delete `--agent-address` option block entirely.
  - Add `.check()` that requires `argv.email` OR `ProfileContext.getActive()?.email`, otherwise throws `new Error('--email required (or run \`bounty profile use <name>\`)')`.
  - In `handler`, exit 1 if neither source resolves.
  - Stop importing `resolveAddressOption`, `resolveCurrentAgentAddress`, `BOUNTY_IM_ADDRESS`-derived helpers.
- [ ] **Step 4:** Run: `bun test tests/cli/bounty-cli-email-only.test.ts`. **Expected:** PASS.
- [ ] **Step 5 (REFACTOR):** Extract the email-resolution logic to `src/cli/lib/email-flag.ts::requireEmailFlag(argv)` so the same logic is shared across 14 commands without duplication.
- [ ] **Step 6:** Run: `bun run test:cli:fast`. **Expected:** all tests green.
- [ ] **Step 7:** Commit:
  ```bash
  git add src/cli/commands/bounty-task/grab.ts src/cli/lib/email-flag.ts tests/cli/bounty-cli-email-only.test.ts
  git commit -m "refactor(cli): bounty-task grab accepts only --email (v0.14)"
  ```

### Task 2: CLI flag surface — `bounty-task submit` (verbatim pattern)

Repeat Task 1 with `submit.ts`. Same RED → GREEN → REFACTOR cadence, same shared helper `requireEmailFlag`.

### Task 3: CLI flag surface — `bounty-task publish` (publisher-email rename)

`publish.ts` currently uses `--publisher-address / -p` for publisher identity. The v0.14 contract renames this to `--publisher-email / -e`. Note that `publish.ts` already has `-p` as `--publisher-address`; v0.14 swaps the alias. Verify no other flag uses `-e` in this file.

### Tasks 4–7: `bounty-task {board, complete, cancel, board}`

`board.ts` doesn't carry actor identity in its own body, but the URL filter `?publisherId=<email>` is documented as email now. `complete.ts` / `cancel.ts` use `--publisher-address / -p` and need `--publisher-email / -e`.

### Tasks 8–12: `com/{send, inbox, connect, disconnect, addresses}`

`send.ts`: drop `--from / -f` and `--to / -t`. Keep `--from-email / -F` and `--to-email / -T` only. Note `--server-url / -e` is **re-aliased to `-u`** in v0.14 to free `-e` for the future extension and align with `auth/*` / `register-agent/*` aliases. If Decision Q3 says "do NOT re-alias", keep `-e`. Otherwise re-alias.

`inbox.ts`: drop `--address / -a`, keep `--email / -e`.

`connect.ts`: drop `--address / -a`, keep `--email / -e`. WS URL becomes `ws://.../ws?email=`.

`disconnect.ts`: drop `--address / -a`, keep `--email / -e`.

`addresses.ts`: drop `--agent-id / -a`, keep `--email / -e`. Stub prints profile email.

### Tasks 13–18: `auth/login`, `register-agent/{info,get,delete,credits,login}`, `profile/add`

Each drops `--agent-address / -a` (or `--agent-id / -a`) and only retains `--email / -e`. `profile/add` additionally drops `--agent-id`.

### Task 19: Server — new `src/lib/email-resolver.ts` (RED → GREEN → REFACTOR)

**Files:**
- Create: `src/lib/email-resolver.ts`
- Create: `tests/server/email-resolver.test.ts`

- [ ] **Step 1 (RED):** write `tests/server/email-resolver.test.ts` with two failing tests:
  ```ts
  describe("parseEmail", () => {
    test("accepts registered-shape email", () => {
      const { parseEmail } = require("@/lib/email-resolver.js");
      expect(parseEmail("alice@example.com", "email").ok).toBe(true);
    });
    test("REJECTS uuid@host (v0.14 strict)", () => {
      const { parseEmail } = require("@/lib/email-resolver.js");
      expect(parseEmail("8de9b6aa-...@host", "email").ok).toBe(false);
    });
    test("REJECTS bare UUID", () => {
      expect(parseEmail("8de9b6aa-5781-4a65-be96-45185fb7c8b1", "email").ok).toBe(false);
    });
    test("REJECTS empty / non-string", () => {
      expect(parseEmail("", "email").ok).toBe(false);
      expect(parseEmail(null, "email").ok).toBe(false);
    });
  });

  describe("findAgentByEmail", () => {
    test("returns {id, email, canonicalAddress} for registered email", () => {
      // in-memory DB seeded with one agent
      const { findAgentByEmail } = require("@/lib/email-resolver.js");
      const row = findAgentByEmail(memDb, "alice@example.com");
      expect(row).toEqual({ id: "uuid-x", email: "alice@example.com", canonicalAddress: "uuid-x@bounty.local" });
    });
    test("returns null for unknown valid-shape email", () => {
      const { findAgentByEmail } = require("@/lib/email-resolver.js");
      expect(findAgentByEmail(memDb, "ghost@example.com")).toBeNull();
    });
  });
  ```
- [ ] **Step 2:** Run: `bun test tests/server/email-resolver.test.ts`. **Expected:** all fail with "module not found".
- [ ] **Step 3 (GREEN):** implement `src/lib/email-resolver.ts`:
  - `parseEmail(input, field)` — strict RFC-5322-ish regex (the same `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` already used in `findAgentByEmail`); rejects anything with multiple `@`, leading/trailing whitespace, length > 254 (DNS limit), empty local part, empty domain, empty TLD.
  - `findAgentByEmail(db, email)` — `SELECT id, email, address FROM agents WHERE email = ?`.
  - `formatCanonicalAddress(uuid, host)` — internal helper retained for IM push.
- [ ] **Step 4:** Run: `bun test tests/server/email-resolver.test.ts`. **Expected:** all pass.
- [ ] **Step 5 (REFACTOR):** de-duplicate regex into a `EMAIL_RE` constant; document the test matrix in the file header.
- [ ] **Step 6:** Commit: `refactor(server): introduce email-only resolver (v0.14)`.

### Task 20: Server — `bounty-routes.ts` (`resolveActor` + every endpoint) (RED → GREEN → REFACTOR)

**Files:**
- Modify: `src/server/http/bounty-routes.ts`
- Test: `tests/server/bounty-routes-email-only.test.ts` (replaces `bounty-routes-email-first.test.ts`)

- [ ] **Step 1 (RED):** port the existing 27 tests forward and add:
  - `[RED-15]` `POST /api/tasks` body `{...,publisherAddress:'<uuid>@<host>'}` → 400 "use publisherEmail".
  - `[RED-16]` `PUT /api/tasks/:id/grab` body `{agentAddress:'<uuid>@<host>'}` → 400.
  - `[NEW]` valid email body → 201/200.
  - `[NEW]` valid email but unknown → 404.
  - `[NEW]` malformed email (`alice@`, `@example.com`, `not-an-email`) → 400.
- [ ] **Step 2:** Run failing assertions; all RED.
- [ ] **Step 3 (GREEN):** rewrite `resolveActor(this.db, body, fieldName, authId)`:
  - Read `body[`${fieldName}Email`]` — if present, validate via `findAgentByEmail` (validates shape + lookup). On bad shape → 400. On valid-shape-but-unknown → **404** (Decision Q3).
  - Fall through to JWT-derived `authId` if present.
  - On no source → 400 "use `<field>Email` (v0.14 strict)".
  - Reject `body[`${fieldName}Address`]` fields with 400.
- [ ] **Step 4:** Run tests; pass.
- [ ] **Step 5 (REFACTOR):** inline error strings to a `EMAIL_ONLY_HINT` constant shared with `im-routes.ts`.
- [ ] **Step 6:** Commit: `refactor(server): bounty routes accept only *Email (v0.14)`.

### Task 21: Server — `im-routes.ts` (RED → GREEN → REFACTOR)

**Files:**
- Modify: `src/server/http/im-routes.ts`
- Modify: `src/server/http/index.ts` (resolver wiring)
- Test: `tests/server/im-routes-email-only.test.ts` (new)

- [ ] **Step 1 (RED):** write 7 tests:
  - `[RED-17]` `POST /api/messages` body `{from, content}` (no `from_email`) → 400.
  - `[RED]` `GET /api/messages?address=<uuid>@<host>` → 400 "use ?email=".
  - `[NEW]` `POST /api/messages` body `{from_email, to_email, content}` with `to_email` mapped to canonical UUID@host internally → 201; `messages.to_address` stored as canonical (Decision Q4).
  - `[NEW]` unknown recipient email → 404.
- [ ] **Step 2:** Run; fail.
- [ ] **Step 3 (GREEN):** rewrite `sendMessage`, `getMessagesForAddress`, `getMessages` (protected), `getMessageByIdPublic` to require email-shape.
- [ ] **Step 4:** Run; pass.
- [ ] **Step 5 (REFACTOR):** delete `normalizeAgentIdentifier` (no longer required); clarify that `messages.{from,to}_address` always stores canonical.
- [ ] **Step 6:** Commit: `refactor(server): IM routes accept only email (v0.14)`.

### Task 22: Server — `auth-routes.ts` (RED → GREEN → REFACTOR)

- [ ] Drop `body.address` in `register`. Drop `body.agent_id` in `login`. Both endpoints now accept only `email`.
- [ ] Add tests:
  - `register` with `body.address` → 400.
  - `login` with `body.agent_id` (no `email`) → 400.
  - `login` with registered email → 200 + token.
  - `login` with unknown email → 401 (preserves 401 for auth failure per HTTP semantics).
- Commit: `refactor(server): auth routes accept only email (v0.14)`.

### Task 23: Delete legacy resolver + parser modules

- [ ] Delete `src/lib/address.ts`, `src/cli/lib/address-parser.ts`, `src/server/lib/address-resolver.ts` after Task 19's resolver takes over.
- [ ] Run: `grep -r "parseAddress\|parseAgentAddress\|findAgentByAddress\|findAgentByEmailOrAddress\|parseEmail\b" src/ tests/`. Expected: 0 matches outside `src/lib/email-resolver.ts` and its consumers.
- Commit: `refactor(server): remove legacy uuid@host resolver (v0.14)`.

### Task 24: `src/cli/lib/current-agent.ts` — profile-only email resolution

- [ ] Delete `resolveCurrentAgent` / `resolveCurrentAgentAddress`. Replace with `resolveActiveProfileEmail(): string | undefined` that reads `ProfileContext.getActive()?.email`. CLI commands that need a default actor email call this; if undefined, they exit 2.
- [ ] Delete `BOUNTY_IM_ADDRESS` references in `src/cli/cli.ts` (the EventSource registration block reads this env).
- [ ] Tests added in `tests/cli/profile-email-resolve.test.ts`.
- Commit: `refactor(cli): replace BOUNTY_IM_ADDRESS with profile.email (v0.14)`.

### Task 25: Version bump + CHANGELOG

- [ ] `package.json`: `"version": "0.13.4"` → `"0.14.0"`.
- [ ] `CHANGELOG.md`: prepend new `## [v0.14.0]` section with `### Removed`, `### Changed`, `### Migration` subsections.
- [ ] Add a strict migration snippet:
  ```
  // before (v0.13.x)
  bounty bounty-task grab --task-id <id> --agent-address <uuid>@<host>
  // after (v0.14+)
  bounty bounty-task grab --task-id <id> --email alice@example.com
  ```
- Commit: `chore(release): bump version to 0.14.0 (BREAKING email-only contract)`.

### Task 26: Final test sweep + build + verify

- [ ] `bun run typecheck` → exit 0.
- [ ] `bun run test:fast` (parallel 4) → exit 0.
- [ ] `bun run test` (default serial) → exit 0.
- [ ] `bun run build` → exit 0 + 4 dist artifacts.
- [ ] `grep -r -- '--agent-address\|--publisher-address\|<uuid>@<host>\|BOUNTY_IM_ADDRESS' src/cli src/server src/lib | grep -v '^.*://'` returns 0 lines.
- [ ] Make sure README points to CHANGELOG v0.14 migration section.

### Task 27: Stage report + user notification

- [ ] Create `task_operation_create(action_type='completed')` summarizing:
  - Files changed / deleted / added counts.
  - Test counts: passed / failed / new RED tests authored.
  - Build outputs.
  - Confirmation that **`main` is untouched**, branch `refactor/bounty-email-only` is ready for review.
- [ ] Open question: ask user to confirm merge to `main` (not auto-merged).

## 风险与依赖 (Risks & Dependencies)

### A. K8s prod / live callers

Live CLIs in the field may still pass `--agent-address` (the v0.13 release was tagged `v0.13.0` and then hot-fixed to v0.13.4). A HARD upgrade without warning breaks scripts. **Mitigation:** CHANGELOG and README migration guide are published in the same release; v0.14.0 is the only available version (this is a breaking minor bump). Long-term users on v0.13.x can pin.

### B. WS payload shape change

WebSocket clients today subscribe at `/ws?email=<email>` (v0.13+). The v0.14 contract removes `/ws?address=<uuid>@<host>`. Subscribers using an IM socket on the old path will reconnect and re-subscribe. No server-side data migration needed (storage column survives).

### C. Profile JSON files without `email`

Users who created profiles via `bounty profile add --api-base ... --token ... --agent-id ...` (the v0.13 path) have profiles without `email`. CLI commands that previously defaulted to profile `agent_id` resolve will now fail because no email is in the profile. **Mitigation:** add `bounty profile migrate` (helper) command that reads `--agent-id` from the existing profile and resolves email via `getAgentById` server-side, then writes `email` back into the profile JSON. This migration command is part of v0.14.0.

### D. Test parallelisation flake

`bun run test:fast` (parallel 4) was observed to be 4× faster but to expose state-sharing bugs in tests that touch the global config dir or env. The task uses `BOUNTY_MAIL_DRY_RUN=1` to suppress SMTP side effects. New tests must avoid `process.env.BOUNTY_*` writes unless guarded by an env-var mutex.

### E. `package.json` dependencies unchanged

Per parent task #2103 rule 8: do not edit `package.json` dependencies. This refactor doesn't need new deps; only the `version` field is touched.

### F. `BOUNTY_IM_ADDRESS` removal breaks EventSource auto-registration

`src/cli/cli.ts` lines 143–163 register `bounty-im` EventSource using `process.env.BOUNTY_IM_ADDRESS`. With this env **deleted** (Decision Q5 ✅), auto-registration is silenced; users must `bounty profile use <name>` (whose `.email` field provides the canonical identity) before manually attaching the `bounty-im` EventSource if they want push-style routing. Documented in CHANGELOG `### Removed` + `### Migration`.

## 完成定义 (Definition of Done — DoD)

1. **Code:** all 27 tasks above committed (one commit per task or grouped per concern; conventional commits).
2. **Tests:** `bun run typecheck && bun run test && bun run test:fast && bun run build` all exit 0. New tests added (≥20 RED cases) and existing tests updated to the strict contract.
3. **Docs:** CHANGELOG entry + README upgrade callout + this plan doc linked from CHANGELOG.
4. **Branch hygiene:** `refactor/bounty-email-only` is committed and pushed to a working tree at `/home/dzk/work/codework/personal/roy_world/ai-agent-bounty-worktrees/refactor-bounty-email-only`. **`main` is untouched.**
5. **Auto-merge:** disabled. Final task operation `action_type='completed'` reports "ready for review, awaiting merge approval".
6. **Risk acknowledgement:** all six decision points (Q1, Q2, Q3, Q4, Q5, Q6) are RESOLVED with user-confirmed choices (see Decision Record). Phase 4 executes against the final choices; no further user prompts required for the refactor itself (other than the eventual merge-to-main approval).

---

## Decision Record (决策记录 — ✅ 全部确认于 2026-07-17)

> 🔵 The user's 2026-07-17 Phase 3 RESUME message confirmed all six decision points in one batch. The task description's "暂停询问用户，不得擅自决定" rule is now fully satisfied — Phase 4 Execute begins against these FINAL choices without further user prompts (until the final merge-to-main approval).

### ✅ Q1. `agents.address` DB column — **KEEP**

- **Final choice:** KEEP `agents.address` as the IM-canonical `<uuid>@<host>` storage column. Do NOT drop; do NOT rename.
- **Rationale (user-confirmed):** the column is the canonical primary key in the IM model; FK joins from `messages.{from,to}_address`, WS push routing, and `tasks.{publisher,assignee}_id` joins all depend on it. Migration cost of any rename / drop is non-trivial and out of scope for v0.14.
- **Surface implication:** `agents.address` survives in the schema and in internal routing. CLI surface and HTTP body **never** accept it as input. The CLI flag surface (`--agent-address`, `--publisher-address`, `--address`, `--agent-id`) is deleted across all 14 commands.
- **Code touch:** none to schema; only input-boundary deletion.

### ✅ Q2. Lookup API path — **KEEP `/api/agents/by-email`**

- **Final choice:** KEEP the v0.13 path `GET /api/agents/by-email?email=<email>` unchanged.
- **Rationale (user-confirmed):** symmetry with `by-id`; the path is already documented and used by k8s prod callers; renaming mid-cycle is gratuitous churn.
- **Surface implication:** `GET /api/agents/by-email?email=alice%40example.com` returns 200 with the agent record (registered) or 404 (unknown — see Q3). No `by-id/email` or `?email=` on the collection root is introduced.

### ✅ Q3. Unregistered valid-format email error code — **404 Not Found**

- **Final choice:** Server returns **404 Not Found** when the email has a syntactically-valid format but the agent is not in the `agents` table. Returns **400 Bad Request** for malformed input (`missing @`, whitespace, empty).
- **Rationale (user-confirmed):** clean separation — bad data 400 vs missing resource 404. Aligns with REST semantics used elsewhere in the API surface.
- **Surface implication:** every endpoint that resolves an actor (`resolveActor` in `bounty-routes.ts`, `findAgentByEmail` in `email-resolver.ts`, `sendMessage` in `im-routes.ts`) returns the new shape. `error.code = 'agent_not_found'`, `error.message = "No registered agent for email '<email>'"`. Tests in Tasks 19, 20, 21 add this case explicitly.

### ✅ Q4. WS payload storage format — **canonical `<uuid>@<host>`**

- **Final choice:** Server stores canonical `<uuid>@<host>` in `messages.from_address` / `messages.to_address`. Clients see **only** the email on input; the canonical form is internal-only.
- **Rationale (user-confirmed):** the v0.13.4 fix (`fix(server): im sendMessage stores canonical <uuid>@<host> for to_address`) is preserved; further normalization would break WS push routing that consumers have already integrated against.
- **Surface implication:** the email → canonical mapping happens **server-side** in `findAgentByEmail` resolver (Task 19). No new column is added; `messages.from_email` is **not** introduced.

### ✅ Q5. `BOUNTY_IM_ADDRESS` env var — **DELETE entirely**

- **Final choice:** DELETE the `BOUNTY_IM_ADDRESS` env var AND the auto-registration of `bounty-im` EventSource at `src/cli/cli.ts:143-163`.
- **Rationale (user-confirmed):** task mandate "no implicit fallback" — leaving the env var as a fallback for cron jobs reintroduces the same silent-misrouting class of bug this refactor is fixing. Users who want `bounty-im` push-style routing must opt in explicitly via `bounty profile use <name>` + the EventSource config file.
- **Surface implication:** `src/cli/cli.ts` drops the `if (process.env.BOUNTY_IM_ADDRESS) { ... }` block. `src/cli/lib/current-agent.ts` `resolveCurrentAgentAddress` and `BOUNTY_IM_ADDRESS` references are deleted. CHANGELOG `### Removed` subsection lists the env var. Migration note: "Use `bounty profile use <name>` to set active identity before enabling `bounty-im` EventSource."

### ✅ Q6. `com send --server-url` alias — **`-u` (re-aliased away from `-e`)**

- **Final choice:** `--server-url` is **re-aliased to `-u`** across **all** consumer commands, including `com/send.ts` which currently declares `alias: 'e'`.
- **Rationale (user-confirmed):** yargs alias collision would silently merge `--server-url -e <url>` and `--from-email -e <email>` into arrays, breaking the strict-email contract at the yargs layer. Standardising on `-u` aligns with `addServerUrlOption` helper which already exports `-u` for `com/{inbox,connect,disconnect}.ts`.
- **Surface implication:** in Task 8 (`com/send.ts` RED → GREEN → REFACTOR), the option definition is changed from `alias: 'e'` to `alias: 'u'`. CHANGELOG marks this as a v0.14 BREAKING minor flag-alias rename. Any wrapper that passes `-e` expecting `--server-url` will need to switch to `-u` or use the long form.

> **Decision-blocking DISMISSED:** all six decision points are FINAL as recorded above. Phase 4 Execute will proceed against these choices without further user prompts (only the eventual merge-to-main approval remains). If at any future point the user reverses a choice (e.g. "actually delete agents.address"), this Decision Record becomes the diff to apply.

---

## Phase 3 RESUME Plan — Repairing Code-Review Blocker #7 (2026-07-17 14:12 UTC)

> 🔵 **Context:** Code-review re-run 7 (operation 15735, 2026-07-17 13:13 UTC) returned `NEEDS_FIX` against `refactor/bounty-email-only` HEAD. CLI regression grew from main baseline `525 pass / 8 fail` to HEAD `504 pass / 36 fail` (29 new unique failures). The 7 blockers below MUST be repaired before resuming Phase 4 (Tasks 9–18, 20–27). TDD discipline preserved: every repair starts with a RED test, turns GREEN, then REFACTOR. `auto_merge=false` throughout — final stop is `refactor/bounty-email-only`, awaiting user merge-to-main approval.

### The 7 Blockers

| # | Blocker | Source |
|---|---|---|
| **B-1** | `requireEmailFlag` / `requireActiveProfileEmail` helper is **absent**. The five bounty commands (`grab`, `submit`, `publish`, `complete`, `cancel`) parse only explicit `argv.email` / `argv.publisherEmail`, ignoring active profile when no flag is provided. | Review 15735: "[Previous blockers propagated] requireEmailFlag is still absent…" |
| **B-2** | `bounty-task/board.ts` was treated as a no-op during Task 7 — no `--publisher-email` filter, no legacy input rejection, no test asserting the filter contract. | Review 15735: "board was incorrectly treated as no-op without publisher-email filter" |
| **B-3** | `com/send.ts` declares `--server-url` with `alias: 'e'`, which collides with `--email` / `--from-email` / `--to-email` choices in `auth/*`, `register-agent/*`, `bounty-task/*`. This was chosen autonomously while Q3 (now Decision Q6) was unresolved. | Review 15735: "com send --server-url alias decision was chosen while unresolved" |
| **B-4** | CLI regression expanded from main 525/8 to HEAD 504/36 (29 new unique failures). Includes non-legacy complete/cancel behavior, com send auth/TLS/transport, publish large-payload & JSON/quiet, network/auth/business/409 handling, and multiple profile suites. | Review 15735: "Fresh baseline-first CLI comparison: main 525 pass / 8 fail; HEAD 504 pass / 36 fail" |
| **B-5** | Email-only tests pass narrowly (39/39) but **lack runtime GREEN behavior coverage** and active-profile fallback coverage. RED asserts parse-time rejection only; nothing asserts that a valid registered email reaches the runtime HTTP body with `{agentEmail}` populated and without `agentAddress`. | Review 15735: "Focused regression: bounty-task-grab-profile.test.ts … crash before profile tests can run" |
| **B-6** | `com/send.ts` `--from-email` / `--to-email` flags still flag-only — no active-profile fallback, no parser centralisation, no runtime GREEN body assertion. Same defect class as B-1 but in the `com/*` namespace. | Operation 15736: "defects spread to complete/cancel/com" |
| **B-7** | Tasks 9–18 (auth/login, register-agent/{info,get,delete,credits,login}, com/{inbox,connect,disconnect,addresses}, profile/add) + Tasks 20–22 (server endpoints) + Tasks 23–27 (cleanup/version/docs/report) are still PENDING. Version bump `0.13.4 → 0.14.0` not done. CHANGELOG + README not updated. Serial `bun test` sweep not run. Final code review not done. | Plan Task 19 partial-complete; remaining work enumerated in plan rows 277–438 |

### Ordered TDD Repair Plan (R-1 through R-7)

> **Rule:** every repair step starts with a RED failing test, then the smallest GREEN change, then a REFACTOR pass. Helper extractions land in `src/cli/lib/email-flag.ts::requireEmailFlag` (existing plan §Task 1 Step 5) and `src/cli/lib/email-flag.ts::resolveActiveProfileEmail`. Tests use `bun test <file> --parallel 4` for fast iteration, **default serial `bun test <file>`** before commit, and `BOUNTY_MAIL_DRY_RUN=1` for any test that touches the network.

#### R-1. Land `requireEmailFlag` + active-profile helper (addresses B-1, partially B-6)

1. **RED (`tests/cli/email-flag.test.ts`)** — three new failing tests:
   - `[R1-RED-1]` `requireEmailFlag({email: 'alice@example.com'})` returns parsed email; `requireEmailFlag({})` exits 1 with "use --email <your-registered-email>".
   - `[R1-RED-2]` when `BOUNTY_PROFILE=alice` env or `ProfileContext.getActive() === 'alice'`, `requireEmailFlag({})` returns `'alice@example.com'` (the active profile's `email` field) without a CLI flag.
   - `[R1-RED-3]` active-profile read takes precedence over `BOUNTY_IM_ADDRESS` env (which is being deleted in Q5; assert that the env is **ignored**).
2. **GREEN** — implement `src/cli/lib/email-flag.ts`:
   ```ts
   export function resolveActiveProfileEmail(): string | undefined;
   export function requireEmailFlag(argv: {email?: string; [k: string]: unknown},
     fieldName = 'email'): {ok: true; value: string} | {ok: false; exit1: true};
   ```
   Uses `ProfileContext.getActive()?.email`; never reads `BOUNTY_IM_ADDRESS` (Q5 deletion).
3. **REFACTOR** — move the seven duplicated email-validation blocks (`src/cli/commands/{bounty-task,com,register-agent,auth,profile}/*.ts`) onto `requireEmailFlag`. Five bounty commands + `com/send.ts` updated in this repair.
4. Tests: `bun test tests/cli/email-flag.test.ts --parallel 4` → green; `bun test tests/cli` (default serial) → green with the B-4 regression shrunk.

#### R-2. Wire `board.ts` to `requireEmailFlag` + add publisher filter (addresses B-2)

1. **RED (`tests/cli/bounty-task-board-publisher.test.ts`)**:
   - `[R2-RED-1]` `bounty bounty-task board --publisher-email alice@example.com` calls `bountyHttp.list({publisherEmail: 'alice@example.com'})`; assert request body / query string.
   - `[R2-RED-2]` `bounty bounty-task board` (no flag) with `BOUNTY_PROFILE=alice` uses active profile email.
   - `[R2-RED-3]` `bounty bounty-task board --publisher-address <uuid>@<host>` exits 1 with "use --publisher-email".
2. **GREEN** — rewrite `src/cli/commands/bounty-task/board.ts`:
   - Add `.option('publisher-email', { alias: 'e', type: 'string' })`.
   - Call `requireEmailFlag(argv, 'publisher-email')` (treating the field rename as a single field identity — keep alias `e`).
   - Pass `{publisherEmail: parsed.value}` to `bountyHttp.list`.
3. **REFACTOR** — extract any query-string assembly shared with inbox / connect.
4. Commit: `refactor(cli): bounty-task board strict email-only with publisher filter (v0.14)`.

#### R-3. Re-alias `com/send.ts` `--server-url` to `-u` (addresses B-3; executes Decision Q6)

1. **RED (`tests/cli/com-send-server-url-alias.test.ts`)**:
   - `[R3-RED-1]` `com/send.ts` yargs parser accepts `--server-url -u https://host:443`; rejects `-e` as an alias for `--server-url`.
   - `[R3-RED-2]` `--from-email -F alice@example.com` and `--server-url -u https://...` parse as independent options (no yargs array collision).
   - `[R3-RED-3]` using legacy `-e <url>` for `--server-url` exits 1 with "use -u instead".
2. **GREEN** — change `src/cli/commands/com/send.ts` option definition from `alias: 'e'` to `alias: 'u'`; route the warning + error string through `requireEmailFlag`'s shared-error helper.
3. **REFACTOR** — switch `com/send.ts` to call `addServerUrlOption(y)` from `src/cli/lib/server-url-option.ts` (already used by inbox/connect/disconnect). This is the natural canonical single-source-of-truth.
4. Commit: `refactor(cli): com send --server-url alias -u (v0.14 BREAKING flag rename)`.

#### R-4. Shrink the CLI regression (addresses B-4)

1. **Baseline** — `BOUNTY_MAIL_DRY_RUN=1 bun test tests/cli --parallel 4 > /tmp/baseline-cli.log` against `main`; record fail count.
2. **Per-command** — for each of the 29 NEW unique failures identified in review 15735:
   - Locate the test (likely a `*-profile.test.ts` or `*-network.test.ts`).
   - Apply R-1 (use `requireEmailFlag`) and provide a valid email arg in the test setup.
   - Preserve the original assertion (network status, business logic, 409, large-payload, JSON, quiet).
3. **Coverage gate** — `bun run test:cli:fast` after each command update; full default-serial `bun test tests/cli` before moving on.
4. **Final** — repeat the baseline comparison; goal: HEAD's fail count ≤ main's fail count (8 fail), with any residual delta explicitly enumerated in the closing report.

#### R-5. Add runtime GREEN assertions to email-only tests (addresses B-5)

1. **RED (`tests/cli/bounty-cli-email-runtime.test.ts`)** — for each of the five bounty commands:
   - `[R5-RED-1]` Capture the HTTP layer (use a `bountyHttp` mock or a `BountyHttpSpy` harness) and assert the body sent contains `agentEmail: 'alice@example.com'` AND does NOT contain `agentAddress`.
   - `[R5-RED-2]` With active profile, no flag, assert the body still has `agentEmail`.
2. **GREEN** — the existing `parseEmail` + `requireEmailFlag` plumbing already sends `{agentEmail}`; the test simply hasn't asserted on it.
3. **REFACTOR** — extract the `BountyHttpSpy` to `tests/cli/helpers/http-spy.ts` for reuse across 39 existing tests.
4. Commit: `test(cli): runtime GREEN body assertions for email-only contract (v0.14)`.

#### R-6. `com/send.ts` sender identity through `requireEmailFlag` (addresses B-6)

1. **RED (`tests/cli/com-send-identity.test.ts`)**:
   - `[R6-RED-1]` `--from-email -F alice@example.com --to-email -T bob@example.com` sends body `{from_email: 'alice@…', to_email: 'bob@…'}`. Capture via BountyHttpSpy from R-5.
   - `[R6-RED-2]` without `--from-email`, with `BOUNTY_PROFILE=alice`, uses active-profile email as `from_email`.
   - `[R6-RED-3]` with `--from alice@example.com` (legacy bare `--from`) exits 1 with "use --from-email".
2. **GREEN** — `src/cli/commands/com/send.ts` already parses `fromEmail` / `toEmail` (per existing Task 8 code); replace its inline `parseEmail(...)` ladder with `requireEmailFlag(argv, 'fromEmail')` + `requireEmailFlag(argv, 'toEmail')`.
3. **REFACTOR** — share the helper with R-1.
4. Commit: `refactor(cli): com send identity via requireEmailFlag (v0.14)`.

#### R-7. Resume the rest of Phase 4 (addresses B-7)

1. **Tasks 9–18** — CLI commands for `auth/login`, `register-agent/{info,get,delete,credits,login}`, `com/{inbox,connect,disconnect,addresses}`, `profile/add` — follow the verbatim R-1 → R-2 → R-5 pattern (one commit per command or grouped logically).
2. **Tasks 19–22** — server endpoints (`email-resolver.ts`, `bounty-routes.ts::resolveActor`, `im-routes.ts`, `auth-routes.ts`). Apply Q3 (404 unknown) + Q4 (canonical storage) decisions; runtime GREEN tests using the `bountyHttp` mock layer.
3. **Task 23** — delete legacy resolvers (`src/lib/address.ts`, `src/cli/lib/address-parser.ts`, `src/server/lib/address-resolver.ts`) and `normalizeAgentIdentifier`. Grep gate: `grep -rE "parseAddress|parseAgentAddress|findAgentByAddress|findAgentByEmailOrAddress|parseEmail\b" src/ tests/ | grep -v "src/lib/email-resolver.ts"` returns 0 matches.
4. **Task 24** — `src/cli/lib/current-agent.ts` becomes `resolveActiveProfileEmail`-only; `BOUNTY_IM_ADDRESS` references in `src/cli/cli.ts` deleted (Q5).
5. **Task 25** — version bump `0.13.4 → 0.14.0`; CHANGELOG `# [v0.14.0]` section with `### Removed`, `### Changed`, `### Migration` listing exactly:
   - `--agent-address / -a`, `--publisher-address / -p`, `--from / --to`, `--address / -a`, `--agent-id / -a` (com/addresses, profile/add), `--id / -i`, `BOUNTY_IM_ADDRESS` env, `body.*Address`, `body.agent_id`.
   - Migration: "Use `bounty profile use <name>` before any IM/CLI flow that previously relied on `BOUNTY_IM_ADDRESS`. For HTTP body fields, rename `*Address` → `*Email`."
6. **Task 26** — final test sweep:
   - `bun run typecheck` → exit 0.
   - `bun run test:cli:fast` (parallel 4) → 0 new failures vs main baseline.
   - `bun test tests/cli` (default serial) → 0 failing.
   - `bun run build` → exit 0 with `dist/cli/*.js`, `dist/bin/bounty.js`, `dist/server/server.js`, `dist/plugin/index.js` all present.
7. **Task 27** — Stage report + 飞书 notification to user with the diff summary, fail-count comparison, and the merge-to-main approval request.
8. **Final state** — worktree `refactor-bounty-email-only` (8 commits ahead of main, growing to N commits); branch **STOPPED**, awaiting user merge-to-main approval; `auto_merge=false` until that explicit approval.

### Repair-Plan Exit Criteria

- All 7 blockers enumerated above show green in `bun run test:cli:fast` and `bun test tests/cli` (default serial).
- All 18 RED tests in plan §Acceptance Criteria pass.
- All 7 GREEN tests in plan §Acceptance Criteria pass.
- `grep -rE "agent-address|publisher-address|BOUNTY_IM_ADDRESS|<uuid>@<host>" src/cli/commands/ src/cli/cli.ts src/cli/lib/` → 0 matches in **active flag descriptions** (comments documenting the removal are fine).
- Final code review (re-run 8) returns `APPROVED`.
- Version on `refactor/bounty-email-only` HEAD is `0.14.0`.
- 飞书 notification sent; merge-to-main prompt issued; no autonomous merge executed.

> **Auto-merge:** `false` end-to-end. The user remains the sole approver of the merge to `main`.
