/**
 * Tests for `resolveCurrentAgent()` — auto-infer current agent from env / token.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: bounty-task/* 命令当前要求用户必须显式传 `--publisher-id` 或
 * `--agent-id`，但其实这些信息可以通过环境变量自动推断：
 *   1. `BOUNTY_IM_ADDRESS` (形如 `agent-uuid@host`) → 提取 agent-uuid 部分
 *   2. `~/.config/bounty/token` (JWT) → 解码 payload.sub (JWT subject claim = agent id)
 *
 * 优先级: BOUNTY_IM_ADDRESS > ~/.config/bounty/token > undefined
 *
 * 测试场景：
 * 1. 不存在任何 env/token 时返回 undefined
 * 2. BOUNTY_IM_ADDRESS 存在时返回 agent-id 部分（去掉 @host 后缀）
 * 3. 只有 token 文件存在时返回 undefined（JWT decode 是后续 phase, 本阶段先聚焦 env）
 * 4. BOUNTY_IM_ADDRESS 优先于 token 文件
 * 5. BOUNTY_IM_ADDRESS 可为纯 id（无 @）以兼容旧用法
 * 6. BOUNTY_IM_ADDRESS 为空字符串时回退到 token 文件
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('resolveCurrentAgent', () => {
  let tempDir: string;
  let tokenPath: string;
  let origImAddress: string | undefined;

  beforeEach(() => {
    origImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_IM_ADDRESS;

    tempDir = join(tmpdir(), `bounty-current-agent-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'token');
  });

  afterEach(() => {
    if (origImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = origImAddress;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('exports resolveCurrentAgent function', async () => {
    const mod = await import('../../src/cli/lib/current-agent.js');
    expect(typeof mod.resolveCurrentAgent).toBe('function');
  });

  test('returns undefined when no BOUNTY_IM_ADDRESS and no token file', async () => {
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    const result = resolveCurrentAgent({ tokenPath });
    expect(result).toBeUndefined();
  });

  test('extracts agent-id from BOUNTY_IM_ADDRESS (uuid@host format)', async () => {
    const agentId = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
    process.env.BOUNTY_IM_ADDRESS = `${agentId}@bounty.tongagents.example.com`;

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    const result = resolveCurrentAgent({ tokenPath });
    expect(result).toBe(agentId);
  });

  test('handles BOUNTY_IM_ADDRESS without port suffix', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'agent-abc@localhost';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent({ tokenPath })).toBe('agent-abc');
  });

  test('accepts pure id BOUNTY_IM_ADDRESS for backward compatibility', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'no-at-sign-here';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    const result = resolveCurrentAgent({ tokenPath });
    expect(result).toBe('no-at-sign-here');
  });

  test('BOUNTY_IM_ADDRESS takes priority over token file existence', async () => {
    const agentId = 'priority-agent-id';
    process.env.BOUNTY_IM_ADDRESS = `${agentId}@host`;
    // 即便 token 文件存在, IM_ADDRESS 优先
    writeFileSync(tokenPath, 'jwt-token-content', 'utf-8');

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent({ tokenPath })).toBe(agentId);
  });

  test('empty BOUNTY_IM_ADDRESS falls back to undefined (not just env)', async () => {
    process.env.BOUNTY_IM_ADDRESS = '';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    // 空字符串 = 没设 env, 走 fallback (没 token 时 undefined)
    expect(resolveCurrentAgent({ tokenPath })).toBeUndefined();
  });
});