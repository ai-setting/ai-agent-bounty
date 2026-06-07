
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
