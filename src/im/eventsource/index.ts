/**
 * Bounty IM EventSource Module
 * 
 * 导出 EventSourceHandler 实现（会自动注册到 EventSourceInitHooks）
 */

// 导入并触发自动注册
import "./bounty-im-handler.js";

// 导出 EventSourceHandler 和类型
export { bountyIMHandler } from "./bounty-im-handler.js";
export type { BountyIMInstance, BountyIMEnvConfig } from "./bounty-im-handler.js";
