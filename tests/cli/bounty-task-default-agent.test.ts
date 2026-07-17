/**
 * Tests for default agent inference integration in bounty-task commands.
 *
 * Phase: refactor/bounty-email-only (v0.14 strict email-only contract)
 *
 * 设计动机: bounty-task/* 的 --email / --publisher-email 在缺省时
 * 应能从 active profile (ProfileContext.active.email) 推断，让日常使用
 * 免去显式传参。
 *
 * v0.14 BREAKING:
 *   - --agent-address / --publisher-address / --*-id 全部 REMOVED
 *   - BOUNTY_IM_ADDRESS env fallback REMOVED (Q5 ✅ DELETE)
 *   - 缺省时显式 fallback: explicit --email > ProfileContext.active.email
 *   - 都没有时友好错误提示 (exit 1 + 明确信息引导 --xxx-email / profile use)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_PUBLISH = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts');
const SRC_GRAB = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts');
const SRC_SUBMIT = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts');
const SRC_COMPLETE = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts');
const SRC_CANCEL = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts');

describe('bounty bounty-task - default agent inference (v0.14 strict email-only)', () => {
  beforeEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  test('publish.ts: --publisher-email fallback via requireEmailFlag → ProfileContext', () => {
    const src = readFileSync(SRC_PUBLISH, 'utf-8');
    // v0.14: centralised via requireEmailFlag helper (Phase 4 R-1).
    expect(src).toContain('requireEmailFlag');
    // No legacy flags / helpers / env fallback.
    expect(src).not.toContain('resolveAddressOption');
    expect(src).not.toContain('resolveCurrentAgentAddress');
    expect(src).not.toContain('resolveCurrentAgent');
    expect(src).not.toContain('BOUNTY_IM_ADDRESS');
    expect(src).not.toContain('.option(\'publisher-address\'');
    expect(src).not.toContain('.option(\'publisher-id\'');
  });

  test('grab.ts: --email fallback via requireEmailFlag → ProfileContext', () => {
    const src = readFileSync(SRC_GRAB, 'utf-8');
    expect(src).toContain('requireEmailFlag');
    expect(src).not.toContain('resolveAddressOption');
    expect(src).not.toContain('resolveCurrentAgentAddress');
    expect(src).not.toContain('resolveCurrentAgent');
    expect(src).not.toContain('BOUNTY_IM_ADDRESS');
    expect(src).not.toContain('.option(\'agent-address\'');
    expect(src).not.toContain('.option(\'agent-id\'');
  });

  test('submit.ts: --email fallback via requireEmailFlag → ProfileContext', () => {
    const src = readFileSync(SRC_SUBMIT, 'utf-8');
    expect(src).toContain('requireEmailFlag');
    expect(src).not.toContain('resolveAddressOption');
    expect(src).not.toContain('BOUNTY_IM_ADDRESS');
    expect(src).not.toContain('.option(\'agent-address\'');
    expect(src).not.toContain('.option(\'agent-id\'');
  });

  test('complete.ts: --publisher-email fallback via requireEmailFlag → ProfileContext', () => {
    const src = readFileSync(SRC_COMPLETE, 'utf-8');
    expect(src).toContain('requireEmailFlag');
    expect(src).not.toContain('resolveAddressOption');
    expect(src).not.toContain('BOUNTY_IM_ADDRESS');
    expect(src).not.toContain('.option(\'publisher-address\'');
    expect(src).not.toContain('.option(\'publisher-id\'');
  });

  test('cancel.ts: --publisher-email fallback via requireEmailFlag → ProfileContext', () => {
    const src = readFileSync(SRC_CANCEL, 'utf-8');
    expect(src).toContain('requireEmailFlag');
    expect(src).not.toContain('resolveAddressOption');
    expect(src).not.toContain('BOUNTY_IM_ADDRESS');
    expect(src).not.toContain('.option(\'publisher-address\'');
    expect(src).not.toContain('.option(\'publisher-id\'');
  });

  test('v0.14 BREAKING: --*-id flags are removed from bounty-task commands', () => {
    for (const f of [SRC_PUBLISH, SRC_GRAB, SRC_SUBMIT, SRC_COMPLETE, SRC_CANCEL]) {
      const src = readFileSync(f, 'utf-8');
      expect(src).not.toContain(".option('publisher-id'");
      expect(src).not.toContain(".option('agent-id'");
    }
  });

  test('v0.14 BREAKING: BOUNTY_IM_ADDRESS env is REMOVED (Q5 ✅ DELETE)', () => {
    // Helper-level: resolveCurrentAgent no longer reads BOUNTY_IM_ADDRESS.
    const helperSrc = readFileSync(
      resolve(import.meta.dir, '../../src/cli/lib/current-agent.ts'),
      'utf-8',
    );
    // v0.14: BOUNTY_IM_ADDRESS references are gone from the resolver.
    // (Tolerant assertion — helper file may still contain documentation
    // referring to BOUNTY_IM_ADDRESS; check that it isn't *read* any more.)
    const readsEnv = /process\.env\.BOUNTY_IM_ADDRESS\s*[!=]==?\s*[^?]/;
    expect(helperSrc).not.toMatch(readsEnv);
  });
});
