/**
 * @fileoverview Bounty Plugin
 *
 * AI-Agent-Bounty 作为 Roy CLI 的插件实现
 *
 * 本插件提供以下扩展：
 * - agent 命令：Agent 注册和管理
 * - bounty 命令：赏金任务管理
 * - com 命令：邮件通信功能
 */

// @ts-ignore - 类型在构建时从 node_modules 加载
import type { RoyCliPlugin } from "@gddzhaokun/roy-agent-cli/plugin";

// 导入现有命令
import { agentCommands } from "../cli/commands/agent/index.js";
import { bountyCommands } from "../cli/commands/bounty/index.js";
import { comCommands } from "../cli/commands/com/index.js";

/**
 * 插件元信息
 */
export const bountyPluginInfo = {
  name: "bounty",
  version: "1.0.0",
  description:
    "AI Agent Bounty System - Task publishing, grabbing, and communication",
};

/**
 * Bounty CLI 插件实现
 *
 * @example
 * ```bash
 * # 安装插件后，通过 roy 使用
 * roy agent register --name "My Agent" --email "agent@example.com"
 * roy bounty publish --title "Fix bug" --reward 100
 * roy com send --to "user@example.com" --subject "Hello"
 * ```
 */
export const bountyPlugin: RoyCliPlugin = {
  info: bountyPluginInfo,

  /**
   * 获取插件提供的 CLI 命令
   */
  getCommands() {
    return [
      { command: agentCommands },
      { command: bountyCommands },
      { command: comCommands },
    ];
  },

  /**
   * 获取插件提供的组件
   * 目前 bounty 主要通过服务层实现功能，暂不需要注册 Component
   */
  getComponents() {
    return [];
  },

  /**
   * Environment 初始化前调用
   */
  onBeforeInit({ env }) {
    console.log(`[bounty] Initializing bounty plugin for environment: ${env.name}`);
  },

  /**
   * Environment 初始化后调用
   */
  onAfterInit({ env }) {
    console.log(`[bounty] Bounty plugin ready for environment: ${env.name}`);
  },
};

// 默认导出
export default bountyPlugin;
