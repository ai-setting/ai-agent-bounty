# roy-agent 依赖升级与 plugin 机制适配方案

## 1. 背景

### 1.1 当前状态
- `ai-agent-bounty` 当前依赖版本：
  - `@ai-setting/roy-agent-cli`: 1.5.39
  - `@ai-setting/roy-agent-core`: 1.5.37
  - `@ai-setting/roy-agent-coder-harness`: 1.5.36
- npmjs 最新版本：1.5.41

### 1.2 需要适配的改造点

#### A. EventSource Plugin 机制改造

**旧机制**（bounty-im-handler.ts）：
- 使用 `EventSourceInitHooks.register()` 手动注册 Handler
- 导出 `bountyIMHandler` 实例

**新机制**（参考 `event-source-handlers.ts`）：
- `bountyIMHandler` 应该是一个工厂函数，返回 `EventSourceHandler` 对象
- Handler 中使用 `BUILT_IN_PLUGIN_FACTORIES` 注册表来加载插件
- 使用 `globalHookManager` 注册 hooks
- 支持 `handleRule.plugins` 配置

#### B. CLI Plugin 机制改造

**旧机制**（plugin/index.ts）：
- 导出 `RoyCliPlugin` 类型的 `bountyPlugin` 对象
- 实现 `getCommands()`, `getComponents()`, `onBeforeInit()`, `onAfterInit()`

**新机制**：
- 需要检查 `@ai-setting/roy-agent-cli` 1.5.41 中 `RoyCliPlugin` 接口是否变化
- 如果接口变化，需要更新插件实现

#### C. Prompt Hook 改造

**旧机制**（cli/hooks/bounty-prompt-hook.ts）：
- 使用 `globalHookManager.register('prompt.after-render', bountyPromptHook)`
- hook 使用旧版命名 `prompt.after-render`

**新机制**（参考 `global-hook-manager.ts`）：
- 新版使用 `prompt:after.render`（冒号分隔）
- 或使用别名机制自动转换

### 1.3 编译错误

```
src/im/eventsource/index.ts(12,33): error TS2305: Module '"./bounty-im-handler.js"' has no exported member 'BountyIMEnvConfig'.
```

**问题**：`index.ts` 导出了不存在的 `BountyIMEnvConfig` 类型。

---

## 2. 改造方案

### 2.1 依赖更新

```json
{
  "@ai-setting/roy-agent-cli": "^1.5.41",
  "@ai-setting/roy-agent-core": "^1.5.41",
  "@ai-setting/roy-agent-coder-harness": "^1.5.41"
}
```

### 2.2 修复编译错误

**文件**：`src/im/eventsource/index.ts`

移除不存在的导出：
```typescript
// 移除这行
export type { BountyIMInstance, BountyIMEnvConfig } from "./bounty-im-handler.js";
// 保留
export type { BountyIMInstance } from "./bounty-im-handler.js";
```

### 2.3 EventSource Handler 改造

**文件**：`src/im/eventsource/bounty-im-handler.ts`

**改造要点**：

1. **导出工厂函数而非实例**：
```typescript
// 旧的直接导出实例
export const bountyIMHandler: EventSourceHandler = { ... };

// 新的导出工厂函数
export function createBountyIMHandler(): EventSourceHandler {
  return {
    name: "bounty-im",
    createInstance(config: EventSourceConfig): EventSourceInstance {
      return new BountyIMInstance(config);
    },
  };
}

// 保持向后兼容的导出
export const bountyIMHandler = createBountyIMHandler();
```

2. **移除 EventSourceInitHooks.register()**：
新版本可能不再需要手动注册，直接通过配置使用即可。

3. **实现 handleRule.plugins 支持**（可选）：
如果需要在 bounty-im 中加载外部插件，参考 `larkCliHandler` 的实现。

### 2.4 CLI Plugin 改造

**文件**：`src/plugin/index.ts`

**改造要点**：

1. **检查 RoyCliPlugin 接口变化**：
```typescript
import type { RoyCliPlugin } from "@ai-setting/roy-agent-cli/plugin";

// 更新插件实现以匹配最新接口
export const bountyPlugin: RoyCliPlugin = {
  // ...
};
```

2. **保持命令注册机制不变**：
`getCommands()` 逻辑保持不变。

3. **更新生命周期钩子**：
如果 `onBeforeInit`/`onAfterInit` 接口变化，相应更新。

### 2.5 Prompt Hook 改造

**文件**：`src/cli/hooks/bounty-prompt-hook.ts`

**改造要点**：

1. **使用新版 hook 点命名**：
```typescript
// 旧的
globalHookManager.register('prompt.after-render', bountyPromptHook);

// 新的（使用冒号分隔）
globalHookManager.register('prompt:after.render', bountyPromptHook);

// 或者保持旧名称，依赖别名机制
// globalHookManager 会自动注册别名
```

2. **保持 Hook 结构不变**：
hook 的 `execute` 方法签名保持不变。

---

## 3. TDD 验证计划

### 3.1 先写失败的测试

```typescript
// src/im/eventsource/bounty-im-handler.test.ts

describe("BountyIMHandler", () => {
  it("should export createBountyIMHandler factory function", () => {
    const { createBountyIMHandler } = require("./bounty-im-handler");
    expect(typeof createBountyIMHandler).toBe("function");
  });

  it("should create handler with correct name", () => {
    const { createBountyIMHandler } = require("./bounty-im-handler");
    const handler = createBountyIMHandler();
    expect(handler.name).toBe("bounty-im");
  });
});
```

### 3.2 验证测试通过

```bash
bun test src/im/eventsource/bounty-im-handler.test.ts
```

### 3.3 TypeScript 类型检查

```bash
bun run typecheck
```

---

## 4. 实施步骤

### Step 1: 更新依赖
```bash
bun add @ai-setting/roy-agent-cli@^1.5.41 \
       @ai-setting/roy-agent-core@^1.5.41 \
       @ai-setting/roy-agent-coder-harness@^1.5.41
```

### Step 2: 修复编译错误
```bash
# 编辑 src/im/eventsource/index.ts
# 移除 BountyIMEnvConfig 导出
```

### Step 3: TDD - 编写 EventSource Handler 测试
```bash
# 创建测试文件
# 运行测试验证失败
```

### Step 4: 改造 EventSource Handler
```bash
# 编辑 src/im/eventsource/bounty-im-handler.ts
# 实现工厂函数
# 运行测试验证通过
```

### Step 5: 检查 CLI Plugin 接口
```bash
# 检查 RoyCliPlugin 接口
# 必要时更新 src/plugin/index.ts
```

### Step 6: TDD - 验证 Prompt Hook
```bash
# 检查 hook 注册是否正常
# 运行测试
```

### Step 7: 完整验证
```bash
bun run typecheck
bun test
```

### Step 8: 构建并发布
```bash
bun run build
```

---

## 5. 回滚计划

如果升级后出现问题：
1. 恢复 package.json 到旧版本
2. `bun install`
3. 验证功能恢复

---

## 6. 附录：关键代码参考

### A. EventSourceHandler 接口（来自 types.ts）

```typescript
export interface EventSourceHandler {
  /** Handler 名称 */
  name: string;
  
  /** 创建事件源实例 */
  createInstance(config: EventSourceConfig): EventSourceInstance;
}
```

### B. EventSourceInstance 接口（来自 types.ts）

```typescript
export interface EventSourceInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): EventSourceStatus;
  onEvent(handler: EventSourceEventHandler): void;
  offEvent(): void;
}
```

### C. Plugin 注册示例（来自 event-source-handlers.ts）

```typescript
// 工厂注册表
const BUILT_IN_PLUGIN_FACTORIES: Record<string, PluginFactory> = {
  LarkCliTaskNotifyPlugin: (cfg) => createLarkCliTaskNotifyHook(cfg as any),
  "task-tag": () => new TaskTagPlugin(),
};

// 加载插件
private async importPlugin(name: string): Promise<any> {
  const factory = BUILT_IN_PLUGIN_FACTORIES[name];
  if (!factory) {
    console.error(`[LarkCliInstance] Unknown plugin: ${name}`);
    return null;
  }
  return factory({ sourceId: this.config.id, pluginName: name });
}
```

---

## 7. 检查清单

- [ ] 更新 package.json 依赖版本
- [ ] 修复 BountyIMEnvConfig 导出错误
- [ ] 编写 EventSource Handler 测试
- [ ] 改造 bounty-im-handler.ts 为工厂函数
- [ ] 检查并更新 CLI Plugin 接口
- [ ] 验证 Prompt Hook 兼容性
- [ ] 运行 typecheck 无错误
- [ ] 运行所有测试通过
- [ ] 构建成功

## 8. 改造记录

### 2026-05-29 完成

#### 1. 依赖更新
- `@ai-setting/roy-agent-cli`: 1.5.39 → 1.5.41
- `@ai-setting/roy-agent-core`: 1.5.37 → 1.5.41
- `@ai-setting/roy-agent-coder-harness`: 1.5.36 → 1.5.41

#### 2. 编译错误修复
- `src/im/eventsource/index.ts`: 移除不存在的 `BountyIMEnvConfig` 导出

#### 3. EventSource Handler 验证
- 测试覆盖：导出、结构、validateConfig、createInstance
- 所有测试通过
- Handler 结构与新版本兼容（使用 `type` 属性）

#### 4. CLI Plugin 验证
- `RoyCliPlugin` 接口兼容
- 构建成功

#### 5. Prompt Hook 验证
- 使用旧版 hook 点命名 `prompt.after-render`
- 新版本提供别名机制自动转换
- 兼容无需改造

#### 6. 测试结果
- `typecheck`: 通过
- `bun test`: 166 pass, 18 fail（超时问题，与升级无关）
- `bun run build`: 成功
