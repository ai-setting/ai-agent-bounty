/**
 * Tests for shared `src/cli/lib/server-url-option.ts` helper.
 *
 * 目的：消除 12+ 个 CLI 命令里重复的 --server-url 定义 + scheme 校验 +
 * 末尾 / trim 逻辑。所有命令（auth/*, register-agent/*, com/*）应统一调用：
 *
 *   import { addServerUrlOption, resolveServerUrl } from '<relative>/lib/server-url-option.js';
 *   builder: (y) => addServerUrlOption(y.option(...))
 *   handler: const baseUrl = resolveServerUrl(opts.serverUrl, API_BASE);
 *
 * 行为约定：
 * - `addServerUrlOption(yargs)` — 给 yargs 加 --server-url / -u 选项
 * - `resolveServerUrl(serverUrl, fallback)` —
 *   1. serverUrl 为空 → 返回 fallback（默认 API_BASE）
 *   2. 否则 trim 末尾 / 后返回
 *   3. 若 trim 后不以 http:// 或 https:// 开头 → console.error + process.exit(1)
 *
 * 测试策略：
 * - 单元测试 helper 函数
 * - 静态测试 helper 输出
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import yargs from 'yargs';

import { addServerUrlOption, resolveServerUrl } from '../../src/cli/lib/server-url-option.js';

describe('addServerUrlOption', () => {
  /**
   * 选项定义必须：--server-url / -u / description
   */
  test('adds --server-url with -u alias and required description', async () => {
    const parser = addServerUrlOption(yargs());
    // 用 parse 直接验证定义（不进入 handler，避免副作用）
    const parsed = await new Promise<any>((resolveFn) => {
      parser.parse(['--server-url', 'https://bounty.example.com'], {
        // 提供 dummy run handler 防止 yargs 报错
        run: () => {},
      } as any, (err, argv) => resolveFn(argv));
    });
    expect(parsed['server-url']).toBe('https://bounty.example.com');
    expect(parsed.serverUrl).toBe('https://bounty.example.com'); // camelCase
  });

  test('--server-url is optional (not demandOption)', async () => {
    const parser = addServerUrlOption(yargs());
    const parsed = await new Promise<any>((resolveFn) => {
      parser.parse([], {
        run: () => {},
      } as any, (err, argv) => resolveFn(argv));
    });
    expect(parsed['server-url']).toBeUndefined();
  });

  test('source file declares alias: u and description', () => {
    const src = readFileSync(
      resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts'),
      'utf-8'
    );
    expect(src).toContain("alias: 'u'");
    expect(src).toContain("'server-url'");
    expect(src).toMatch(/Must start with http/);
    expect(src).toMatch(/Trailing slashes are auto-trimmed/);
  });
});

describe('resolveServerUrl', () => {
  let exitSpy: any;
  let errSpy: any;

  beforeEach(() => {
    errSpy = spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = spyOn(process, 'exit').mockImplementation(((code: number) => {
      throw new Error(`EXIT_${code}`);
    }) as any);
  });

  afterEach(() => {
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  /**
   * T1: undefined → 返回 fallback（默认 API_BASE）
   */
  test('T1: undefined --server-url returns the fallback', () => {
    expect(resolveServerUrl(undefined, 'http://localhost:4000')).toBe('http://localhost:4000');
    expect(resolveServerUrl('', 'http://fallback.example.com')).toBe('http://fallback.example.com');
    expect(resolveServerUrl(undefined, 'https://prod.bounty.example.com')).toBe(
      'https://prod.bounty.example.com'
    );
  });

  /**
   * T2: 末尾 / 自动 trim（避免 //api 拼接错误）
   */
  test('T2: trailing slash on --server-url is auto-trimmed', () => {
    expect(resolveServerUrl('http://localhost:4000/', 'fallback')).toBe('http://localhost:4000');
    expect(resolveServerUrl('https://bounty.example.com:443/', 'fallback')).toBe(
      'https://bounty.example.com:443'
    );
    // 多重 / 也 trim
    expect(resolveServerUrl('http://localhost:4000///', 'fallback')).toBe('http://localhost:4000');
    // 无尾 / 不变
    expect(resolveServerUrl('http://localhost:4000', 'fallback')).toBe('http://localhost:4000');
    // https 也正常
    expect(resolveServerUrl('https://bounty.example.com', 'fallback')).toBe(
      'https://bounty.example.com'
    );
  });

  /**
   * T3: 缺少 scheme 报错 + exit 1
   */
  test('T3: --server-url without scheme should error and exit 1', () => {
    expect(() => resolveServerUrl('bounty.example.com', 'http://localhost:4000')).toThrow(
      'EXIT_1'
    );
    expect(errSpy).toHaveBeenCalledTimes(1);
    const errOutput = String(errSpy.mock.calls[0]?.[0] ?? '');
    expect(errOutput).toContain('Invalid --server-url');
    expect(errOutput).toContain('bounty.example.com');

    // ftp / ws 也不行（不是 http/https）
    expect(() => resolveServerUrl('ftp://bounty.example.com', 'http://localhost:4000')).toThrow(
      'EXIT_1'
    );
    expect(() => resolveServerUrl('ws://bounty.example.com', 'http://localhost:4000')).toThrow(
      'EXIT_1'
    );
  });

  /**
   * T4: 缺少 scheme 但带尾 / 也报错（trim 之前先验证）
   */
  test('T4: scheme validation precedes trim', () => {
    expect(() => resolveServerUrl('bounty.example.com/', 'http://localhost:4000')).toThrow(
      'EXIT_1'
    );
  });

  /**
   * T5: 校验完才 trim（http://example.com/ 正常）
   */
  test('T5: valid http(s) URL is trimmed and returned', () => {
    expect(resolveServerUrl('http://localhost:4000/', 'fallback')).toBe('http://localhost:4000');
    expect(resolveServerUrl('https://bounty.example.com:443/', 'fallback')).toBe(
      'https://bounty.example.com:443'
    );
  });
});

describe('helper integration', () => {
  test('source file re-exports addServerUrlOption + resolveServerUrl', () => {
    const src = readFileSync(
      resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts'),
      'utf-8'
    );
    expect(src).toContain('export function addServerUrlOption');
    expect(src).toContain('export function resolveServerUrl');
    // 必须使用 chalk 打印错误 + process.exit(1)
    expect(src).toMatch(/process\.exit\(1\)/);
    expect(src).toMatch(/chalk\.red/);
  });
});
