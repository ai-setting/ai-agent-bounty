# Bounty Profile Commands PR2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL loading (before any code changes):
> 1. `test-driven-development` — every phase: RED → GREEN → Refactor
> 2. `verification-before-completion` — evidence before any "done" claim
> 3. `using-git-worktrees` — already prepared by `git worktree add`
>
> Task: #2082 (parent #2079 verified)

**Goal:** Implement `bounty profile` command group on top of PR1's profile mechanism. Six commands: `add`, `list`, `show`, `use`, `remove`, `rename`. TDD first; ≥31 new tests; PR1 baseline (708 tests) must remain green.

**Architecture:** Each command is a single `CommandModule` in its own file. The parent `profile` command lives in `index.ts` and composes the six children + `demandCommand(1)`. Commands reuse PR1 store (`saveProfile`, `loadProfile`, `deleteProfile`, `readGlobalConfig`, `writeGlobalConfig`, `listProfiles`, `resolveActiveProfile`) without modification. Test isolation via `__storeOptions?: StoreOptions` seam + `__confirm?: () => Promise<boolean>` for `remove`. `process.exit` is captured via `spyOn` and converted into a thrown sentinel so tests stay in bun's runtime.

**Tech Stack:** bun, yargs, chalk, zod, existing PR1 store/resolver/context.

---

## Worktree State (already prepared)

```
/home/dzk/work/codework/personal/roy_world/ai-agent-bounty-worktrees/feat-profile-commands-pr2
└── branch: feat/profile-commands-pr2 (based on feat/profile-mechanism-pr1 @ dae006e)
```

## Phase Breakdown

### Phase 0 — Bootstrap (already done)

- [x] worktree + branch created from `feat/profile-mechanism-pr1`
- [x] `bun install` (PR1 baseline typecheck + middleware/profile-option tests green)

### Phase 1 — `add` command (~25 min)

- [ ] **1.1** RED: write `tests/cli/profile/add.test.ts` (5+ cases)
- [ ] **1.2** Verify RED: `bun test tests/cli/profile/add.test.ts` — expect 5 failures (missing module)
- [ ] **1.3** GREEN: implement `src/cli/commands/profile/add.ts`
- [ ] **1.4** Verify GREEN: all 5+ tests pass
- [ ] **1.5** Refactor: keep handler pure; extract token/email validation helpers if needed
- [ ] **1.6** Commit: `feat(profile): add profile <name> command`

### Phase 2 — `list` command (~20 min)

- [ ] **2.1** RED: write `tests/cli/profile/list.test.ts` (5+ cases; JSON + table + active marker)
- [ ] **2.2** Verify RED: failures
- [ ] **2.3** GREEN: implement `src/cli/commands/profile/list.ts`
- [ ] **2.4** Verify GREEN
- [ ] **2.5** Commit: `feat(profile): add profile list command`

### Phase 3 — `show` command (~20 min)

- [ ] **3.1** RED: write `tests/cli/profile/show.test.ts` (5+ cases incl. token redaction)
- [ ] **3.2** Verify RED
- [ ] **3.3** GREEN: implement `src/cli/commands/profile/show.ts`
- [ ] **3.4** Verify GREEN
- [ ] **3.5** Commit: `feat(profile): add profile show command`

### Phase 4 — `use` command (~15 min)

- [ ] **4.1** RED: write `tests/cli/profile/use.test.ts` (5+ cases incl. missing config init)
- [ ] **4.2** Verify RED
- [ ] **4.3** GREEN: implement `src/cli/commands/profile/use.ts`
- [ ] **4.4** Verify GREEN
- [ ] **4.5** Commit: `feat(profile): add profile use command`

### Phase 5 — `remove` command (~25 min)

- [ ] **5.1** RED: write `tests/cli/profile/remove.test.ts` (5+ cases incl. active guard + force + confirm seam)
- [ ] **5.2** Verify RED
- [ ] **5.3** GREEN: implement `src/cli/commands/profile/remove.ts`
- [ ] **5.4** Verify GREEN
- [ ] **5.5** Commit: `feat(profile): add profile remove command`

### Phase 6 — `rename` command (~20 min)

- [ ] **6.1** RED: write `tests/cli/profile/rename.test.ts` (5+ cases incl. active sync)
- [ ] **6.2** Verify RED
- [ ] **6.3** GREEN: implement `src/cli/commands/profile/rename.ts`
- [ ] **6.4** Verify GREEN
- [ ] **6.5** Commit: `feat(profile): add profile rename command`

### Phase 7 — `index.ts` parent + integration tests (~25 min)

- [ ] **7.1** RED: write `tests/cli/profile/integration.test.ts` (multi-command end-to-end)
- [ ] **7.2** GREEN: implement `src/cli/commands/profile/index.ts`
- [ ] **7.3** Verify GREEN
- [ ] **7.4** Commit: `feat(profile): add profile command group`

### Phase 8 — Wire into `cli.ts` + smoke test (~10 min)

- [ ] **8.1** Modify `src/cli/cli.ts`: import + register `profileCommands`
- [ ] **8.2** Run `bun run src/bin/bounty.ts profile --help` to confirm yargs registers the group
- [ ] **8.3** Run a smoke add → list → show → use → rename → remove under temp HOME
- [ ] **8.4** Commit: `feat(cli): register profile command group`

### Phase 9 — Final verification + report (~15 min)

- [ ] **9.1** `bun run typecheck` (expect 0 errors)
- [ ] **9.2** `BOUNTY_MAIL_DRY_RUN=1 bun test --isolate --parallel 4` (expect all green; PR2 contributes ≥31)
- [ ] **9.3** `bun run build:cli` (expect dist/cli.js regenerated)
- [ ] **9.4** `git status` clean; `git log main..HEAD` only PR2 commits
- [ ] **9.5** Report branch + commits + files + evidence to user; **do not** merge main
- [ ] **9.6** Optional: `requesting-code-review` skill before final report

---

## File Layout

```
src/cli/commands/profile/
├── index.ts      # parent command; demandCommand(1)
├── add.ts        # add <name> [opts]
├── list.ts       # list [--json]
├── show.ts       # show [--name]
├── use.ts        # use <name>
├── remove.ts     # remove <name> [--force]
└── rename.ts     # rename <old> <new>

tests/cli/profile/
├── add.test.ts
├── list.test.ts
├── show.test.ts
├── use.test.ts
├── remove.test.ts
├── rename.test.ts
└── integration.test.ts
```

## Test Seams (hidden from CLI users)

- Each command handler checks `argv.__storeOptions?: StoreOptions`. Object → use it; otherwise ignore.
- `remove` additionally checks `argv.__confirm?: () => Promise<boolean>`.
- Tests use `tmpdir()` + `profilesDir`/`configFile` so they never touch real `~/.config/bounty/`.
- Tests `spyOn(process, 'exit')` to throw a sentinel exception (same pattern as PR1 middleware tests).

## Key Constraints (Execute MUST honor)

- TDD strict: NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST
- No `BOUNTY_TOKEN` env reads (PR1 removed it)
- No Windows-specific code
- `chmod 0600` stays in PR1 store; commands do NOT re-chmod
- Each command a single atomic commit
- **Never** merge `main`; final report only asks the user
