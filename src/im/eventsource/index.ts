/**
 * Bounty IM EventSource Module
 * 
 * 导出新的 EventSourceHandler 实现
 */

// 导出 EventSourceHandler 实现（会自动注册到 EventSourceInitHooks）
export { bountyIMHandler, initBountyIMHandler } from "./bounty-im-handler.js";
export type { BountyIMInstance } from "./bounty-im-handler.js";
