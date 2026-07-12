/**
 * Tests for `resolveCurrentAgent()` — auto-infer current agent from env / token.
 *
 * Phase: feat/bounty-task-optimize (v0.10 strict refactor)
 *
 * v0.10 BREAKING: BOUNTY_IM_ADDRESS must be in `<uuid>@<host>` format.
 * Bare UUID is REJECTED → resolveCurrentAgent returns undefined.
 *
 * 优先级: BOUNTY_IM_ADDRESS > ~/.config/bounty/token (future) > undefined
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('resolveCurrentAgent (v0.10 strict)', () => {
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

  test('extracts uuid from BOUNTY_IM_ADDRESS (uuid@host format)', async () => {
    const agentId = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
    process.env.BOUNTY_IM_ADDRESS = `${agentId}@bounty.tongagents.example.com`;

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    const result = resolveCurrentAgent({ tokenPath });
    expect(result).toBe(agentId);
  });

  test('handles short hostname (host = "localhost")', async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@localhost';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent({ tokenPath })).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
  });

  test('v0.10 BREAKING: rejects pure-id BOUNTY_IM_ADDRESS (no @host)', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'no-at-sign-here';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    const result = resolveCurrentAgent({ tokenPath });
    expect(result).toBeUndefined();
  });

  test('v0.10 BREAKING: rejects BOUNTY_IM_ADDRESS with non-UUID uuid part', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'not-a-uuid@somewhere.example.com';

    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent({ tokenPath })).toBeUndefined();
  });

  test('BOUNTY_IM_ADDRESS takes priority over token file existence', async () => {
    const agentId = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
    process.env.BOUNTY_IM_ADDRESS = `${agentId}@host.example.com`;
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
