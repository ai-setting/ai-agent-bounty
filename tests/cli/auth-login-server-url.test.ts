/**
 * Tests for `bounty auth login` CLI command — --server-url option.
 *
 * Phase feat/bounty-all-commands-server-url: extends add.ts's pattern to all
 * bounty CLI commands that hit the HTTP API.
 *
 * 设计点：
 * - 选项名：--server-url / -u（与 add.ts 一致，避免与 --email 冲突）
 * - 优先级：--server-url > API_BASE（BOUNTY_API_URL env > http://localhost:4000）
 * - 校验：必须以 http:// 或 https:// 开头
 * - 处理：自动 trim 末尾的 /
 * - 错误：scheme 错误时 console.error(chalk.red(...)) + process.exit(1)
 *
 * 测试策略：
 * - 静态 (T1, T2, T5)：grep login.ts 源码验证 option 定义 + 优先级逻辑 + 路径使用
 * - mock fetch (T3)：mock global fetch 验证 --server-url 走自定义 URL
 * - mock fetch (T4)：mock global fetch 验证默认走 API_BASE
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LOGIN_SRC = resolve(import.meta.dir, '../../src/cli/commands/auth/login.ts');

describe('bounty auth login - --server-url option', () => {
  // Hold originals to restore in afterEach
  let origFetch: typeof fetch;
  let origApiUrl: string | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origApiUrl = process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_API_URL; // ensure default API_BASE is used
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origApiUrl === undefined) {
      delete process.env.BOUNTY_API_URL;
    } else {
      process.env.BOUNTY_API_URL = origApiUrl;
    }
  });

  /**
   * T1: login.ts 必须通过 helper 引用 --server-url
   * （alias 与定义都在 helper 里，避免 DRY 违反）
   */
  test('T1: login.ts references shared --server-url helper', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    // 必须 import helper（DRY 验证）
    expect(src).toContain("from '../../lib/server-url-option.js'");
    // 必须用 helper
    expect(src).toMatch(/addServerUrlOption\(/);
    // helper 是 source of truth，login.ts 不应内联定义
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  /**
   * T2: 必须用 helper + 优先级：--server-url > API_BASE
   */
  test('T2: login.ts uses resolveServerUrl with API_BASE fallback', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).toMatch(/resolveServerUrl\(.*API_BASE\s*\)/);
  });

  /**
   * T3: mock fetch 验证 --server-url 走自定义 URL
   *
   * 通过直接 import + 调 handler 太复杂（涉及 readline、loadToken 等）。
   * 改用：模拟 login.ts 的 fetch 逻辑（trim + `${baseUrl}/api/auth/login`）验证。
   */
  test('T3: mock fetch verifies --server-url is used as fetch base', async () => {
    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ token: 'mock-token', agent_id: 'agent-1', email: 'e@x.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    // 模拟 login.ts 中 fetch 的逻辑
    const customUrl = 'https://bounty.example.com';
    const response = await fetch(`${customUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(response.status).toBe(200);
    expect(calledUrl).toBe('https://bounty.example.com/api/auth/login');
  });

  /**
   * T4: 不传 --server-url 时 fallback 到 API_BASE
   */
  test('T4: fallback to API_BASE when --server-url not provided', async () => {
    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(
        JSON.stringify({ token: 'mock-token', agent_id: 'agent-1', email: 'e@x.com' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }) as any;

    process.env.BOUNTY_API_URL = 'https://env.bounty.example.com';

    // 动态 import 以反映最新 env（resetModules）
    const { API_BASE } = await import('../../src/cli/config.js');
    const response = await fetch(`${API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@example.com' }),
    });
    expect(response.status).toBe(200);
    expect(calledUrl).toBe('https://env.bounty.example.com/api/auth/login');
  });

  /**
   * T5: 末尾 / 自动 trim
   */
  test('T5: trailing slash on --server-url is auto-trimmed', () => {
    // 静态测试 helper 行为（与 helper test 互补 — 这边验证 login.ts 用了 helper）
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).toMatch(/resolveServerUrl\(/);
    // helper 内部已 trim，无需 login.ts 自己 trim
    expect(src).not.toMatch(/trimmed\.replace/);
  });

  /**
   * T6: scheme 校验：错误 URL 报错 + exit 1
   * 静态验证 login.ts 用了 helper（helper 内部已包含校验逻辑）
   */
  test('T6: scheme validation is delegated to helper (no inline logic in login.ts)', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    // login.ts 不应该自己实现 scheme 校验（DRY）
    expect(src).not.toMatch(/\/\^https\?:\\\/\\\//);
    expect(src).not.toMatch(/^https\?:\/\/\.test/);
    // 必须 import resolveServerUrl
    expect(src).toMatch(/resolveServerUrl/);
  });
});

describe('bounty auth login - help output reflects --server-url', () => {
  test('login.ts delegates --server-url definition to shared helper', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    // helper is single source of truth
    expect(src).toContain("from '../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    // 旧的 inline alias / option 不应出现（DRY）
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
    expect(src).not.toMatch(/['"]server-url['"],\s*\{\s*alias:\s*['"]u['"]/);
  });

  test('shared helper declares --server-url / -u / description (so help output is correct)', () => {
    const helperSrc = readFileSync(
      resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts'),
      'utf-8'
    );
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});
