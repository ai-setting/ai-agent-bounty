
## 测试隔离修复：vi.mock 泄漏 + bun test --isolate

## 2026-06-06: 修复测试隔离问题

### 问题
`tests/auth/service.test.ts` 使用顶层 `vi.mock('../../src/auth/jwt.js', ...)` 注册的 mock 会泄漏到同 worker 中的其他测试文件（如 `jwt.test.ts`），导致 jwt 测试使用 mock 实现而非真实实现。

### 根因
- Bun 不支持 `vi.importActual` 和 `vi.unmock`（这是 Vitest API，Bun 未实现）
- `vi.mock` 在 Bun 中是模块级全局拦截，跨文件共享
- `service.test.ts` 的 jwt mock 只导出 `createToken`/`getTokenExpiry`，缺少 `verifyToken`

### 修复方案（3 项变更）

1. **`tests/auth/service.test.ts`**: jwt mock 增加 `verifyToken` 导出（即使泄漏也不 crash）
2. **`tests/auth/service.test.ts`**: verification.js mock 从 `beforeEach` 移到顶层，`beforeEach` 中手动重置 mock 实现
3. **`package.json`**: 测试脚本改为 `bun test --isolate`，确保每个测试文件独立运行，防止 mock 跨文件泄漏

### 验证
- `bun run test -- tests/auth/` — 63 pass ✅
- `bun test tests/auth/jwt.test.ts` — 17 pass ✅
- `bun test tests/auth/service.test.ts` — 17 pass ✅
- 完整测试套件 — 197 pass (13 个 IM/WebSocket timeout 为预存问题，非本次引入)

## Fix bounty CLI log noise with quiet mode

## Fix: bounty CLI log noise with quiet mode

### Problem
`bounty --help` output大量日志噪声（`[INFO]`、`◇ injected env`、`[Bounty] Prompt hook registered` 等）。

### Root Causes
1. **bounty 没有设置 quiet 模式** — `runBountyCli()` 一开始就调用 `initializeBountyEnv()`，组件初始化时所有日志都输出到控制台
2. **`console.log('[Bounty] Prompt hook registered')` 在模块加载时执行** — 早于任何命令执行
3. **`initializeBountyEnv()` 在 CLI 启动时立即执行** — 即使只是 `bounty --help`，也会触发完整 Environment 初始化

### Fix Applied
1. **`src/cli/cli.ts`**:
   - 导入 `setQuietMode` from `@ai-setting/roy-agent-core`
   - 在 `runBountyCli()` 最开头调用 `setQuietMode(true)` — 在 `initializeBountyEnv()` 之前
   - 将 `registerBountyPromptHook()` 从模块顶层移到 `runBountyCli()` 内（在 `setQuietMode(true)` 之后调用）
   - 添加全局 `--quiet` 选项（默认 `true`，使用 `--no-quiet` 开启日志）
   - 添加全局 middleware 在命令执行前设置 quiet 模式

2. **`src/cli/hooks/bounty-prompt-hook.ts`**:
   - 导入 `isQuietMode` from `@ai-setting/roy-agent-core`
   - `console.log('[Bounty] Prompt hook registered')` 改为受 `isQuietMode()` 控制

### Tests
- 新增 `tests/cli/quiet-mode.test.ts` — 9 个测试覆盖所有场景
- 全量 259 测试通过，0 失败

### Verification
1. `bounty --help` 不再输出日志噪声
2. `bounty --no-quiet --help` 可开启日志（可选）
3. 其他命令默认 quiet

## bounty register-agent add 支持 --server-url (v0.4.2)


## 2026-07-09: register-agent add 支持 --server-url (v0.4.2)

**Task #1721** — feature branch `feat/bounty-add-server-url` (worktree isolated).

### 关键决策：alias 用 `-u` 而非 `-e`

`-e` 在 `bounty register-agent/*` 所有子命令 (register/info/login/verify/add) 中已被 `--email` 占用。

**yargs 行为**：如果两个 option 用同一个 alias (e.g. `-e`)，yargs 会把两个 option 的值都收集成 array：
```json
{"email": ["a@b.com","http://x"], "server-url": ["a@b.com","http://x"], "e": [...]}
```
导致 fetch 拿到的 email/url 都是错的（element 0 是 email 值，element 1 是 url 值）。

**send.ts 用 -e 安全**：`bounty com send` 没有 --email 选项，-e 没冲突 → 可以复用。

**add.ts 用 -u 避免冲突**：这是与 send.ts 的有意偏离，已在代码注释和 commit message 中标注原因。

### TDD 流程

1. **RED**：写 `tests/cli/register-agent-add-server-url.test.ts`（T1-T5 + help output）
2. **GREEN**：改 `src/cli/commands/register-agent/add.ts` 加 --server-url/-u + 校验 + trim + 成功时打印 Service URL
3. **REGRESSION**：`bun test --isolate` → 276/276 pass
4. **BUILD**：`bun run build` → 4 个 bundle 全成功
5. **TYPECHECK**：`bunx tsc --noEmit` → 0 错误（与 main 一致）
6. **PUBLISH**：`bun run build:standalone:publish` → @ai-setting/agent-bounty-standalone@0.4.2 上线
7. **INSTALL**：全局安装 + 6 个 mock server 冒烟测试全 pass

### Smoke test 验证

- T2: `--server-url invalid` → "Invalid --server-url" 错误
- T3: `--server-url foo.com` → 同样错误
- T4: `--server-url http://localhost:5555/` (trailing slash) → mock 收到正确 path
- T5: `-u http://localhost:6666` (alias) → 同样工作
- T6: 不传 --server-url, `BOUNTY_API_URL=http://localhost:7777` → 路由到 7777

### 发布状态

| 包 | 版本 | URL |
|----|------|-----|
| `@ai-setting/agent-bounty` | 0.4.1 → 0.4.2 | 本仓库 main |
| `@ai-setting/agent-bounty-standalone` | 0.4.1 → 0.4.2 | https://registry.npmjs.org/@ai-setting/agent-bounty-standalone |

### 踩坑

1. 第一次 publish 后 npm registry 没有立即显示 0.4.2，install 装到 0.4.1。等 ~30s 后 `npm view` 才看到 — 注册表同步延迟。
2. 第二次 publish 时 0.4.2 已经在 registry，直接报 E403 "you cannot publish over previously published version" — 这是预期行为，不是错误。
3. worktree 第一次 `bun test --isolate` 失败（package 找不到），因为 worktree 没有 node_modules，需要 `bun install`。


## ## Bounty CLI v0.5.0 全面优化发布

## Bounty CLI v0.5.0 优化发布 (2026-07-10)

**Task #1735**: 全面优化 Bounty CLI 并发布到 npmjs v0.5.0

### Breaking Changes
- 删除 `bounty server config` 命令（commit bd54ca7）
- 删除 top-level `bounty config` 命令（commit 1ec10f9）
- TLS skip 默认开启，新增 `--tls-verify` opt-in（commit 7bab134 + 5a14247）

### 友好默认值
- `BOUNTY_SERVER_URL` 作为 `BOUNTY_API_URL` alias（commit 93e952e）
- fetch helper `src/cli/lib/fetch-helper.ts` 统一处理 TLS skip
- 所有 auth/register-agent/com 命令支持 `--server-url` / `-u`

### Release Process
- 主包 + standalone 双发布：`@ai-setting/agent-bounty@0.5.0` + `@ai-setting/agent-bounty-standalone@0.5.0`
- 4 bundles + 4 platform standalone binaries
- npm registry 同步延迟 ~30s，二次 publish 会 E403（正常行为）

### Smoke Test 矩阵（必验证）
1. `bounty --version` = 0.5.0
2. `bounty --help` 不含 config 命令
3. `bounty server --help` 只含 start/stop/status
4. `bounty server config` → Unknown argument
5. `bounty config` → Unknown argument
6. `bounty com send --help` 含 `--tls-verify`
7. `bounty auth login --help` 含 `-u, --server-url`
8. `BOUNTY_SERVER_URL=http://127.0.0.1:1 bounty auth status` → HTTP 阶段失败（非 TLS 阶段）

### event-sources.json 更新要点
- 找到 `Bounty IM (Auto)` 和 `Bounty IM (Publisher)`
- 移除 `-k`（TLS skip 默认）
- 新增 `--tls-verify` opt-in 说明
- 新增 `BOUNTY_SERVER_URL` / `BOUNTY_API_URL` env aliases 说明
- 备份原文件为 `.bak-v0.5.0-pre`

### Known Gaps (out of v0.5.0 scope)
- `bounty register-agent info` 和 `credits` 没有 `--server-url` flag
  - 可通过 `API_BASE` / `BOUNTY_API_URL` / `BOUNTY_SERVER_URL` env 覆盖
  - v0.4.3 commit 3501e33 当时未覆盖这 2 个命令
  - 可在未来 v0.5.x 中补齐

### Reference Tasks
- Task #1723 (v0.4.3): --server-url on all commands
- Task #1721 (v0.4.2): register-agent/add --server-url
- Task #1735 (v0.5.0): 全面优化 + 发布

## ## bounty 同步 roy-agent 依赖 (2026-07-10)

## bounty 同步 roy-agent 依赖 (2026-07-10)

**Task #1773** — chore commit `ae6d472` (branch `chore/sync-roy-deps-2026-07-10`).

### 版本升级
| Package | Before | After |
|---|---|---|
| `@ai-setting/roy-agent-cli` | ^1.5.110 | ^1.5.114 |
| `@ai-setting/roy-agent-core` | ^1.5.102 | ^1.5.106 |
| `@ai-setting/roy-agent-coder-harness` | ^1.5.50 | ^1.5.50 (unchanged) |

### 验证结果
- `bun run typecheck`: 0 errors ✅
- `bun test --isolate`: 376 pass / 0 fail ✅
- `bun run build`: 4 bundles success ✅
- Smoke tests: version 0.5.0, no `bounty config`, --tls-verify + --server-url preserved ✅

### 关键经验
1. **Patch 升级无 RED**: roy-agent 1.5.110→1.5.114, 1.5.102→1.5.106 是纯 patch，向后兼容
2. **bun.lock 变化小**: 4 行变化（2 version + 2 sha512），无 transitive dep 变化
3. **worktree 隔离干净**: `.worktrees/` 已 gitignore，4 个遗留 worktrees 不影响
4. **不 push/merge/publish**: 8 commits ahead of origin/main 来自 v0.5.0 release（已 published），本次 chore 仅本地

### Commit message 惯例（沿用 #1458/#1563）
```
chore(deps): upgrade @ai-setting/roy-agent-{cli,core} to latest
```
