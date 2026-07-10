/**
 * Bounty IM EventSource Module
 *
 * 从 Task #1645 起，bounty-im handler 已迁入 @ai-setting/roy-agent core。
 * 本文件保留做向后兼容：
 * 1. re-export core 的 bountyIMHandler / BountyIMInstance
 * 2. 保留 EventSourceInitHooks.register 自动注册（带重复检测，避免覆盖 core 内置 handler）
 * 3. 仅在 ai-agent-bounty 内部保留 bountyConfig 环境变量 fallback（roy-agent core 不保留）
 *
 * 用户用法保持不变：依旧 `import "../im/eventsource/index.js"` 触发自动注册。
 */

import {
  EventSourceInitHooks,
  type EventSourceHandler,
  isQuietMode,
} from "@ai-setting/roy-agent-core";

// Re-export core 实现（address/imServerUrl 必须显式配置）
export { bountyIMHandler, BountyIMInstance } from "@ai-setting/roy-agent-core";

// 防止重复注册：如果 core 已经把 bountyIMHandler 注册到 builtInHandlers，
// 这里只做"幂等注册"避免覆盖（EventSourceComponent 内部已有 warnings，但我们额外保险）。
EventSourceInitHooks.register("bounty-im", async (component) => {
  // 注意：core 内置 handler 已在 builtInHandlers 中自动注册，
  // 这里用 getHandler 检查后跳过，避免重复 console.log。
  const existing = component.getHandler?.("bounty-im");
  if (existing) {
    // core 已经注册了，幂等返回
    return;
  }

  // 兼容老版本 core（没有内置 bounty-im）的情况：从 core 拿 handler 注册
  const { bountyIMHandler: coreHandler } = await import("@ai-setting/roy-agent-core");
  component.registerHandler(coreHandler as EventSourceHandler);
  if (!isQuietMode()) {
    console.log("[BountyIM] Handler registered to EventSourceComponent (legacy path)");
  }
});