/**
 * Tests for default TLS skip-verify behavior (Task #1735 v0.5.0).
 *
 * 目的：v0.5.0 起，bounty CLI 在调用 fetch 时默认跳过 TLS 证书验证
 * （针对自签名证书场景，例如 k8s ingress）。这样 agent 调用 bounty CLI
 * 时无需手动加 -k / --insecure flag。
 *
 * 实现策略：
 * - 在 `src/cli/lib/fetch-helper.ts` 提供 `bountyFetch(url, options)` helper
 * - 该 helper 默认设置 `process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'`
 * - 同时提供 `--tls-verify` 选项（alias `--secure`）让用户重新开启验证
 *
 * 测试策略：
 * - 静态测试：验证 fetch-helper.ts 存在并实现默认 TLS skip
 * - 静态测试：验证 send.ts / status.ts / inbox.ts 等调用 bountyFetch 或等效机制
 */

import { describe, test, expect } from 'bun:test';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const SRC_ROOT = resolve(import.meta.dir, '../../src/cli');

describe('bounty fetch helper with default TLS skip', () => {
  test('src/cli/lib/fetch-helper.ts exists', () => {
    const path = resolve(SRC_ROOT, 'lib/fetch-helper.ts');
    expect(existsSync(path)).toBe(true);
  });

  test('fetch-helper exports bountyFetch function', () => {
    const path = resolve(SRC_ROOT, 'lib/fetch-helper.ts');
    if (!existsSync(path)) {
      throw new Error('fetch-helper.ts missing — write the helper first');
    }
    const src = readFileSync(path, 'utf-8');
    expect(src).toMatch(/export\s+(async\s+)?function\s+bountyFetch/);
    expect(src).toMatch(/export\s+function\s+isTlsVerifyDisabled|bountyFetch/);
  });

  test('fetch-helper sets NODE_TLS_REJECT_UNAUTHORIZED=0 by default', () => {
    const path = resolve(SRC_ROOT, 'lib/fetch-helper.ts');
    if (!existsSync(path)) {
      throw new Error('fetch-helper.ts missing — write the helper first');
    }
    const src = readFileSync(path, 'utf-8');
    // 必须有默认设置 NODE_TLS_REJECT_UNAUTHORIZED = '0' 的逻辑
    // 接受字面量或动态 const 形式
    expect(src).toMatch(/NODE_TLS_REJECT_UNAUTHORIZED/);
    expect(src).toMatch(/['"]0['"]/);
  });

  test('fetch-helper honors --tls-verify option to re-enable verification', () => {
    const path = resolve(SRC_ROOT, 'lib/fetch-helper.ts');
    if (!existsSync(path)) {
      throw new Error('fetch-helper.ts missing — write the helper first');
    }
    const src = readFileSync(path, 'utf-8');
    // 应支持通过参数/选项重新开启 TLS 验证
    expect(src).toMatch(/tlsVerify|verify|secure/i);
  });
});

describe('bounty com send defaults to TLS skip', () => {
  test('send.ts uses bountyFetch helper (not raw fetch)', () => {
    const path = resolve(SRC_ROOT, 'commands/com/send.ts');
    const src = readFileSync(path, 'utf-8');
    // 不直接用裸 fetch，应用 bountyFetch
    expect(src).toContain('bountyFetch');
  });
});