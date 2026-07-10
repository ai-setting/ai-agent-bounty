/**
 * Tests for default agent inference integration in bounty-task commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: bounty-task/* 的 --publisher-id / --agent-id 在缺省时应能从
 * BOUNTY_IM_ADDRESS env 推断，让日常使用免去显式传参。
 *
 * 测试场景：
 * 1. publish: 缺省 --publisher-id 时从 BOUNTY_IM_ADDRESS 推断
 * 2. grab: 缺省 --agent-id 时从 BOUNTY_IM_ADDRESS 推断
 * 3. submit: 缺省 --agent-id 时从 BOUNTY_IM_ADDRESS 推断
 * 4. complete: 缺省 --publisher-id 时从 BOUNTY_IM_ADDRESS 推断
 * 5. cancel: 缺省 --publisher-id 时从 BOUNTY_IM_ADDRESS 推断
 * 6. 都没有时友好错误提示（exit 2 + 明确信息）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PUBLISH = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts');
const SRC_GRAB = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts');
const SRC_SUBMIT = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts');
const SRC_COMPLETE = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts');
const SRC_CANCEL = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts');

describe('bounty bounty-task - default agent inference', () => {
  beforeEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  test('publish.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_PUBLISH, 'utf-8');
    expect(src).toContain('resolveAgentIdOption');
    expect(src).toContain("address: argv['publisher-address']");
    expect(src).toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgent()');
    // Must have friendly error when neither is available
    expect(src).toContain('Cannot infer publisher address');
  });

  test('grab.ts: --agent-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_GRAB, 'utf-8');
    expect(src).toContain('resolveAgentIdOption');
    expect(src).toContain("address: argv['agent-address']");
    expect(src).toContain("deprecatedId: argv['agent-id']");
    expect(src).toContain('fallback: resolveCurrentAgent()');
    expect(src).toContain('Cannot infer agent address');
  });

  test('submit.ts: --agent-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_SUBMIT, 'utf-8');
    expect(src).toContain('resolveAgentIdOption');
    expect(src).toContain("address: argv['agent-address']");
    expect(src).toContain("deprecatedId: argv['agent-id']");
    expect(src).toContain('fallback: resolveCurrentAgent()');
    expect(src).toContain('Cannot infer agent address');
  });

  test('complete.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_COMPLETE, 'utf-8');
    expect(src).toContain('resolveAgentIdOption');
    expect(src).toContain("address: argv['publisher-address']");
    expect(src).toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgent()');
    expect(src).toContain('Cannot infer publisher address');
  });

  test('cancel.ts: --publisher-address fallback to resolveCurrentAgent()', () => {
    const src = readFileSync(SRC_CANCEL, 'utf-8');
    expect(src).toContain('resolveAgentIdOption');
    expect(src).toContain("address: argv['publisher-address']");
    expect(src).toContain("deprecatedId: argv['publisher-id']");
    expect(src).toContain('fallback: resolveCurrentAgent()');
    expect(src).toContain('Cannot infer publisher address');
  });

  test('resolveCurrentAgent correctly extracts agent-id from BOUNTY_IM_ADDRESS', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'agent-xyz-123@bounty.example.com';
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent()).toBe('agent-xyz-123');
  });

  test('resolveCurrentAgent accepts pure id BOUNTY_IM_ADDRESS for backward compatibility', async () => {
    process.env.BOUNTY_IM_ADDRESS = 'agent-xyz-123';
    const { resolveCurrentAgent } = await import('../../src/cli/lib/current-agent.js');
    expect(resolveCurrentAgent()).toBe('agent-xyz-123');
  });
});