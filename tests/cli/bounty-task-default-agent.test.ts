/**
 * Tests for default agent inference integration in bounty-task commands.
 *
 * Phase: feat/bounty-task-optimize (v0.10 strict refactor)
 *
 * 设计动机: bounty-task/* 的 --publisher-address / --agent-address 在缺省时
 * 应能从 BOUNTY_IM_ADDRESS env 推断，让日常使用免去显式传参。
 *
 * v0.10 BREAKING: 全用 `resolveAddressOption` (返回完整 {uuid, host, raw})
 * 不再有 --*-id / deprecatedId alias。
 *
 * 测试场景：
 * 1. publish/grab/submit/complete/cancel: 缺省 address 时从 resolveCurrentAgent() 推断
 * 2. 都没有时友好错误提示 (exit 2 + 明确信息)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PUBLISH = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts');
const SRC_GRAB = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts');
const SRC_SUBMIT = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts');
const SRC_COMPLETE = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts');
const SRC_CANCEL = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts');

describe('bounty bounty-task - default agent inference (v0.10)', () => {
  beforeEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  test('publish.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_PUBLISH, 'utf-8');
    expect(src).toContain('resolveAddressOption');
    expect(src).toContain("address: argv['publisher-address']");
    // v0.10 BREAKING: no deprecatedId alias
    expect(src).not.toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgentAddress()');
    expect(src).toContain('Cannot infer publisher address');
  });

  test('grab.ts: --agent-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_GRAB, 'utf-8');
    expect(src).toContain('resolveAddressOption');
    expect(src).toContain("address: argv['agent-address']");
    expect(src).not.toContain("deprecatedId: argv['agent-id']");
    expect(src).toContain('fallback: resolveCurrentAgentAddress()');
    expect(src).toContain('Cannot infer agent address');
  });

  test('submit.ts: --agent-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_SUBMIT, 'utf-8');
    expect(src).toContain('resolveAddressOption');
    expect(src).toContain("address: argv['agent-address']");
    expect(src).not.toContain("deprecatedId: argv['agent-id']");
    expect(src).toContain('fallback: resolveCurrentAgentAddress()');
    expect(src).toContain('Cannot infer agent address');
  });

  test('complete.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_COMPLETE, 'utf-8');
    expect(src).toContain('resolveAddressOption');
    expect(src).toContain("address: argv['publisher-address']");
    expect(src).not.toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgentAddress()');
    expect(src).toContain('Cannot infer publisher address');
  });

  test('cancel.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_CANCEL, 'utf-8');
    expect(src).toContain('resolveAddressOption');
    expect(src).toContain("address: argv['publisher-address']");
    expect(src).not.toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgentAddress()');
    expect(src).toContain('Cannot infer publisher address');
  });

  test('v0.10 BREAKING: --*-id flags are removed from bounty-task commands', () => {
    for (const f of [SRC_PUBLISH, SRC_GRAB, SRC_SUBMIT, SRC_COMPLETE, SRC_CANCEL]) {
      const src = readFileSync(f, 'utf-8');
      expect(src).not.toContain(".option('publisher-id'");
      expect(src).not.toContain(".option('agent-id'");
    }
  });

  test('resolveCurrentAgent correctly extracts uuid from BOUNTY_IM_ADDRESS (uuid@host)', async () => {
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-5781-4a65-be96-45185fb7c8b1@bounty.example.com';
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent()).toBe('8de9b6aa-5781-4a65-be96-45185fb7c8b1');
  });

  test('v0.10 BREAKING: resolveCurrentAgent rejects bare UUID (no @host) in BOUNTY_IM_ADDRESS', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'agent-xyz-123';
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    // v0.10: bare UUID should fail strict parsing → resolveCurrentAgent returns undefined
    expect(resolveCurrentAgent()).toBeUndefined();
  });
});
