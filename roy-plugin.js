/**
 * @fileoverview Bounty Plugin Entry Point
 *
 * 本文件作为 roy-cli 插件发现机制的入口
 * 被 packages/cli/src/plugin/discover.ts 扫描并加载
 *
 * 文件名固定为 roy-plugin.js，不可更改
 */

export { bountyPlugin } from "./dist/plugin/index.js";
