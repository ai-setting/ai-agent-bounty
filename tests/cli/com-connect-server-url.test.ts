/**
 * Tests for `bounty com connect` CLI command — --server-url option.
 *
 * com/connect.ts 当前用 ws://${host}:${port}/ws 拼接（WebSocket probe），
 * --server-url 应能 override host/port，且允许自定义 scheme（http/https/ws/wss）。
 *
 * 注意：helper 只允许 http/https，但 connect 是 probe 场景，可能需要 ws/wss。
 * 这里我们要求：--server-url 提供时使用 override，未提供时保留 --host/--port。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/connect.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty com connect - --server-url option', () => {
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

  test('T1: connect.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('T2: connect.ts uses resolveServerUrl OR keeps host/port fallback', () => {
    const src = readFileSync(SRC, 'utf-8');
    // 必须用 helper 处理 serverUrl
    expect(src).toMatch(/resolveServerUrl\(/);
    // 必须保留 --host/--port fallback（向后兼容）
    expect(src).toMatch(/\$\{host\}/);
    expect(src).toMatch(/\$\{port\}/);
  });

  test('T3: ws path is preserved (probe endpoint /ws)', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\/ws\?address=/);
  });

  test('T4: scheme validation is delegated to helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/^https\?:\/\/\.test/);
    expect(src).toMatch(/resolveServerUrl/);
  });
});

describe('bounty com connect - help output', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});
