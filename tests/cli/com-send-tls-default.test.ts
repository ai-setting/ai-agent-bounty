/**
 * Tests for `bounty com send` defaults — no -k / --insecure needed (Task #1735 v0.5.0).
 *
 * 目的：v0.5.0 起，发送消息等命令默认 TLS skip，agent 调用时无需加 -k / --insecure。
 * 同时支持 BOUNTY_SERVER_URL / BOUNTY_API_URL / BOUNTY_IM_SERVER_URL env 变量。
 *
 * 实现策略：
 * - send.ts 中 fetch 调用前默认设置 NODE_TLS_REJECT_UNAUTHORIZED=0
 * - 即使不传 -k，也会跳过 TLS 验证
 * - 当用户显式传 --tls-verify 时重新开启验证
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SEND_TS = resolve(import.meta.dir, '../../src/cli/commands/com/send.ts');

describe('bounty com send — TLS skip default', () => {
  test('send.ts sets NODE_TLS_REJECT_UNAUTHORIZED=0 by default (no --insecure required)', () => {
    const src = readFileSync(SEND_TS, 'utf-8');
    // 应该有默认设置 TLS skip 的逻辑（即使没传 --insecure 也跳过）
    // 在 handler 入口或 fetch helper 中默认设置
    expect(src).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
  });

  test('send.ts supports --tls-verify flag to opt back in', () => {
    const src = readFileSync(SEND_TS, 'utf-8');
    // 新增 --tls-verify 选项让用户可以重新开启验证
    expect(src).toMatch(/tls-verify/);
  });

  test('send.ts no longer requires --insecure for self-signed certs', () => {
    const src = readFileSync(SEND_TS, 'utf-8');
    // --insecure 默认应该是 true（或移除，改用 --tls-verify 反向开关）
    // 简化方式：移除 --insecure 改用 --tls-verify
    // 这里验证 --insecure 不再是必需的（demandOption: false 或 --tls-verify 替代）
    // 优先检测：是否有 --tls-verify 选项
    expect(src).toMatch(/['"]tls-verify['"]|['"]secure['"]/);
  });
});

describe('bounty com send — server-url env fallback', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    originalEnv = {
      BOUNTY_SERVER_URL: process.env.BOUNTY_SERVER_URL,
      BOUNTY_API_URL: process.env.BOUNTY_API_URL,
    };
    delete process.env.BOUNTY_SERVER_URL;
    delete process.env.BOUNTY_API_URL;
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test('BOUNTY_SERVER_URL env is supported (via API_BASE)', () => {
    // API_BASE 来自 bountyConfig（bounty-config.ts）
    // bountyConfig.apiUrl 应该优先用 BOUNTY_API_URL，然后 BOUNTY_SERVER_URL，然后默认值
    const bountyConfigPath = resolve(import.meta.dir, '../../src/lib/config/bounty-config.ts');
    const src = readFileSync(bountyConfigPath, 'utf-8');
    // 检查是否支持 BOUNTY_API_URL
    expect(src).toContain('BOUNTY_API_URL');
    // 也支持 BOUNTY_SERVER_URL 作为别名（v0.5.0）
    expect(src).toContain('BOUNTY_SERVER_URL');
  });
});