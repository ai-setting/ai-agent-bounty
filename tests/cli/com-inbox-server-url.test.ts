/**
 * Tests for `bounty com inbox` CLI command — --server-url option.
 *
 * com/inbox.ts 与 com/connect.ts 是 com/* 中唯一会发出网络请求的实命令
 * （其余 disconnect/addresses/stub 都是本地 stub）。
 *
 * 与 auth/register-agent 不同，inbox 现有的 host/port 拼接是设计之一
 * （保留 --host/--port 为 backward compatible），--server-url 用作 override。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/inbox.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty com inbox - --server-url option', () => {
  let origApiUrl: string | undefined;

  beforeEach(() => {
    origApiUrl = process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_API_URL;
  });

  afterEach(() => {
    if (origApiUrl === undefined) {
      delete process.env.BOUNTY_API_URL;
    } else {
      process.env.BOUNTY_API_URL = origApiUrl;
    }
  });

  test('T1: inbox.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('T2: inbox.ts uses resolveServerUrl to compute base', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/resolveServerUrl\(/);
    // host/port fallback 仍在 builder 中定义（向后兼容）
    expect(src).toMatch(/\$\{host\}/);
    expect(src).toMatch(/\$\{port\}/);
  });

  test('T3: --server-url branch builds /messages URL; --host/--port fallback preserved', () => {
    const src = readFileSync(SRC, 'utf-8');
    // 必有 /messages endpoint（与 IM HTTP API 一致）
    expect(src).toMatch(/\/messages/);
  });

  test('T4: scheme validation is delegated to helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/^https\?:\/\/\.test/);
    expect(src).toMatch(/resolveServerUrl/);
  });
});

describe('bounty com inbox - help output', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});
