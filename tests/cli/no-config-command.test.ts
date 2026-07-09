/**
 * Tests for removal of `bounty server config` command (Task #1735 v0.5.0).
 *
 * 目的：验证 v0.5.0 已经移除 `bounty server config` 命令。
 *
 * 决策：
 * - `src/cli/commands/server/config.ts` 文件应该被删除
 * - `server/index.ts` 不应再注册 configCommand
 * - yargs 严格模式下 `bounty server config` 应该报错 "Unknown command"
 *
 * 测试策略：
 * - 静态测试：grep 源码验证 config.ts 不存在，server/index.ts 不再 import configCommand
 * - 静态测试：grep 源码验证 cli.ts 不再有 "config" 命令描述（顶层 roy ConfigCommand 仍可保留）
 *   * 注意：roy-agent-cli 的 ConfigCommand 是独立的（来自依赖），但本仓库不应再注册 server config
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_ROOT = resolve(import.meta.dir, '../../src/cli');

describe('bounty server config removal (v0.5.0)', () => {
  test('src/cli/commands/server/config.ts is deleted', () => {
    const configPath = resolve(SRC_ROOT, 'commands/server/config.ts');
    expect(existsSync(configPath)).toBe(false);
  });

  test('server/index.ts does NOT import configCommand', () => {
    const indexPath = resolve(SRC_ROOT, 'commands/server/index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    expect(src).not.toContain("from './config.js'");
    expect(src).not.toContain('.command(configCommand)');
  });

  test('server/index.ts describe does NOT mention config', () => {
    const indexPath = resolve(SRC_ROOT, 'commands/server/index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    // describe 中不应再列 "config"
    expect(src).not.toMatch(/describe:\s*['"`].*config.*['"`]/i);
  });

  test('server/index.ts builder has only start/stop/status commands (no configCommand)', () => {
    const indexPath = resolve(SRC_ROOT, 'commands/server/index.ts');
    const src = readFileSync(indexPath, 'utf-8');
    // 应包含 start/stop/status
    expect(src).toContain('startCommand');
    expect(src).toContain('stopCommand');
    expect(src).toContain('statusCommand');
    // 不应再 import 或调用 configCommand
    expect(src).not.toMatch(/configCommand/);
  });
});

describe('bountyConfig class still used by internal modules (backward compat)', () => {
  // bountyConfig 是 src/lib/config/bounty-config.ts 的单例，被多个 CLI 命令内部使用
  // (com/send.ts, com/inbox.ts, com/connect.ts, server/*, cli.ts 等)
  // 这些不应该被破坏，仅 CLI 暴露的 server config 命令被移除。
  test('src/lib/config/bounty-config.ts still exists (internal helper)', () => {
    const bountyConfigPath = resolve(SRC_ROOT, '../lib/config/bounty-config.ts');
    expect(existsSync(bountyConfigPath)).toBe(true);
  });
});

describe('bounty top-level config command removal (v0.5.0)', () => {
  // 用户需求 "去掉 bounty config 相关命令行以及逻辑" 同时涵盖顶层 `bounty config`
  // 命令（来自 @ai-setting/roy-agent-cli）。这些 ConfigCommand 在 cli.ts 中被注册，
  // v0.5.0 起应当不注册。
  test('src/cli/cli.ts does NOT import ConfigCommand from roy-agent-cli', () => {
    const cliPath = resolve(SRC_ROOT, 'cli.ts');
    const src = readFileSync(cliPath, 'utf-8');
    expect(src).not.toMatch(/ConfigCommand|ConfigListCommand|ConfigExportCommand|ConfigImportCommand/);
  });

  test('src/cli/cli.ts does NOT register ConfigCommand in yargs builder', () => {
    const cliPath = resolve(SRC_ROOT, 'cli.ts');
    const src = readFileSync(cliPath, 'utf-8');
    expect(src).not.toMatch(/\.command\(\s*ConfigCommand\s*\)/);
    expect(src).not.toMatch(/\.command\(\s*ConfigListCommand\s*\)/);
    expect(src).not.toMatch(/\.command\(\s*ConfigExportCommand\s*\)/);
    expect(src).not.toMatch(/\.command\(\s*ConfigImportCommand\s*\)/);
  });
});