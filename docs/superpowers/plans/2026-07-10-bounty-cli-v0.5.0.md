# Bounty CLI v0.5.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL loading (before any code changes):
> 1. `test-driven-development` — every phase: RED → GREEN → Refactor
> 2. `verification-before-completion` — evidence before any "done" claim
> 3. `finishing-a-development-branch` — used in Phase 9 (merge + cleanup)
>
> (See also task #1735 operation #12389 for the canonical plan record.)

**Goal:** Remove `bounty server config` command, add default-TLS-skip for fetch calls, upgrade roy deps, bump to v0.5.0, publish to npmjs.

**Architecture:** TDD-first, worktree-isolated. Use `NODE_TLS_REJECT_UNAUTHORIZED=0` set globally in CLI middleware (default-on), with `--tls-verify` flag to opt back in. Add a `fetch-helper.ts` for centralized fetch-default application.

**Tech Stack:** bun, yargs, dotenv, @ai-setting/roy-agent-{cli,coder-harness,core}, npmjs registry.

---

## Worktree State (already prepared)

```
.worktrees/feat-bounty-optimize
└── branch: feat/bounty-optimize (clean, based on main @ 13df1d9)
    Untracked RED-state tests (need to be verified RED → GREEN):
    ├── tests/cli/no-config-command.test.ts        ← Phase 1
    ├── tests/cli/tls-default-skip.test.ts         ← Phase 2
    └── tests/cli/com-send-tls-default.test.ts     ← Phase 3
```

## Phase Breakdown

### Phase 1 — Remove `bounty server config` (~15 min)
**RED → GREEN → Refactor**

- [ ] **1.1** Verify RED: `bun test tests/cli/no-config-command.test.ts` — expect 4 failures
- [ ] **1.2** Delete `src/cli/commands/server/config.ts`
- [ ] **1.3** Modify `src/cli/commands/server/index.ts`:
  - Remove `import { configCommand } from './config.js'`
  - Remove `.command(configCommand)`
  - Update describe string to drop "config"
- [ ] **1.4** Verify GREEN: `bun test tests/cli/no-config-command.test.ts` — expect all 5 tests pass
- [ ] **1.5** Grep guard: `grep -rn "config" src/cli/commands/server/` — no stray references
- [ ] **1.6** Commit: `feat(cli): remove bounty server config command (breaking)`

### Phase 2 — Default TLS skip + `--tls-verify` flag (~25 min)
**RED → GREEN → Refactor**

- [ ] **2.1** Verify RED: `bun test tests/cli/tls-default-skip.test.ts` — expect failure (fetch-helper.ts missing)
- [ ] **2.2** Create `src/cli/lib/fetch-helper.ts`
- [ ] **2.3** Wire fetch-helper into `src/cli/cli.ts` middleware
- [ ] **2.4** Verify GREEN: `bun test tests/cli/tls-default-skip.test.ts` — expect all tests pass
- [ ] **2.5** Commit: `feat(cli): default TLS skip with --tls-verify opt-in`

### Phase 3 — Adapt `com send` to new defaults (~15 min)
**RED → GREEN → Refactor**

- [ ] **3.1** Verify RED: `bun test tests/cli/com-send-tls-default.test.ts` — expect failure
- [ ] **3.2** Modify `src/cli/commands/com/send.ts` — remove manual TLS skip; keep `-k` as deprecated alias; add `--tls-verify` option
- [ ] **3.3** Verify GREEN: `bun test tests/cli/com-send-tls-default.test.ts` — all pass
- [ ] **3.4** Verify existing tests still pass: `bun test tests/cli/com-send-server-url.test.ts`
- [ ] **3.5** Commit: `feat(com): remove manual TLS skip in send, rely on global default`

### Phase 4 — BOUNTY_SERVER_URL env fallback (~10 min)
**RED → GREEN → Refactor**

- [ ] **4.1** Create RED test `tests/cli/bounty-config-server-url-env.test.ts`
- [ ] **4.2** Modify `src/lib/config/bounty-config.ts` — extend `apiUrl` getter
- [ ] **4.3** Update `.env.example`
- [ ] **4.4** Verify GREEN
- [ ] **4.5** Commit: `feat(config): support BOUNTY_SERVER_URL as BOUNTY_API_URL alias`

### Phase 5 — Bump version + upgrade roy deps (~15 min)

- [ ] **5.1** `npm view @ai-setting/roy-agent-cli version` → 1.5.110
- [ ] **5.2** `npm view @ai-setting/roy-agent-coder-harness version` → 1.5.50
- [ ] **5.3** `npm view @ai-setting/roy-agent-core version` → 1.5.102
- [ ] **5.4** Modify `package.json`: `version: 0.5.0`, bump dependencies
- [ ] **5.5** Modify `bounty-standalone/package.json`: `version: 0.5.0`
- [ ] **5.6** `bun install`
- [ ] **5.7** `bunx tsc --noEmit` (expect 0 errors)
- [ ] **5.8** `BOUNTY_MAIL_DRY_RUN=1 bun test --isolate` (expect all green)
- [ ] **5.9** Commit: `chore(release): bump version to 0.5.0 + upgrade roy deps`

### Phase 6 — Build + Publish to npmjs (~20 min)

- [ ] **6.1** Clean: `rm -rf dist`
- [ ] **6.2** Build: `bun run build` (expect 4 bundles)
- [ ] **6.3** Standalone: `bun run build:standalone`
- [ ] **6.4** Publish main: `npm publish` → `@ai-setting/agent-bounty@0.5.0`
- [ ] **6.5** Publish standalone: `cd bounty-standalone && npm publish`
- [ ] **6.6** Verify npm registry
- [ ] **6.7** Tag: `git tag v0.5.0 && git push origin v0.5.0`
- [ ] **6.8** Commit any remaining build configs

### Phase 7 — Global install verification (~10 min)

- [ ] **7.1** `npm install -g @ai-setting/agent-bounty-standalone@0.5.0`
- [ ] **7.2** `bounty --version` → `0.5.0`
- [ ] **7.3** `bounty --help` → no "config" command
- [ ] **7.4** `bounty server --help` → sub-commands: start, stop, status (no config)
- [ ] **7.5** `bounty server config` → "Unknown command" error
- [ ] **7.6** `bounty com send --help` → has `--tls-verify`
- [ ] **7.7** `bounty auth login --help` → has `-u, --server-url`
- [ ] **7.8** `bounty register-agent info --help` → has `-u, --server-url`
- [ ] **7.9** Smoke test: `bounty auth status --server-url http://nonexistent.localhost:4000`

### Phase 8 — Update event-sources.json systemPrompts (~15 min)

- [ ] **8.1** Backup: `cp ~/.roy-agent/event-sources.json ~/.roy-agent/event-sources.json.bak-v0.5.0-pre`
- [ ] **8.2** Read full file
- [ ] **8.3** Identify 2 bounty-im entries (`bounty-im-auto` + `bounty-im-publisher`)
- [ ] **8.4** Update each systemPrompt:
  - Remove forced `-k` example (TLS skip now default)
  - Add BOUNTY_SERVER_URL / BOUNTY_API_URL env explanation
  - Add --tls-verify option explanation
  - Remove `bounty config list` reference (command no longer exists)
  - Keep `tlsSkipVerify: true` field unchanged
- [ ] **8.5** Validate JSON via `bun -e "JSON.parse(...)"`
- [ ] **8.6** `task_operation_create` to log the diff (no git commit needed)

### Phase 9 — Merge worktree → main + cleanup (~10 min)

- [ ] **9.1** From main repo dir: `git checkout main && git pull`
- [ ] **9.2** `git merge --no-ff feat/bounty-optimize -m "Merge branch 'feat/bounty-optimize': Bounty CLI v0.5.0"`
- [ ] **9.3** Handle conflicts if any
- [ ] **9.4** Verify merged: `git log --oneline -3 && cat package.json | grep version`
- [ ] **9.5** Post-merge test: `BOUNTY_MAIL_DRY_RUN=1 bun test --isolate`
- [ ] **9.6** Cleanup: `git branch -d feat/bounty-optimize && git worktree remove .worktrees/feat-bounty-optimize`
- [ ] **9.7** Restore stash if any (from before Phase 0)

### Phase 10 — Task closure (~5 min)

- [ ] **10.1** `task_operation_create action_type=milestone` per Phase
- [ ] **10.2** Verify global: `bounty --version` → 0.5.0
- [ ] **10.3** `task_update task_id=1735 status=completed progress=100`

---

## Critical Constraints

1. **Worktree discipline**: All work in `.worktrees/feat-bounty-optimize`. Only switch to main for `git merge`.
2. **TDD priority**: Don't write production code without a failing test first. The 3 untracked tests are Phase 1-3 starting points.
3. **bun only**: `bun test`, `bun run`, `bunx tsc`. No `npm test`, no `node`.
4. **No secrets in code**: npm token is already configured in `~/.npmrc`. Don't add `.npmrc` to repo.
5. **Atomic commits**: One Phase = one commit (or split if >200 lines).
6. **Evidence before assertions**: VERIFY agent will check this. Run commands, capture output, paste in op.
