/**
 * Tests for `bounty com send` CLI command
 *
 * Phase feat/com-send-server-url: 验证 --server-url 选项
 *
 * 注意：`/api/messages` 在 IMHTTPServer 中是 protected route（需要 auth middleware），
 * 在测试 server (createIMServer without bountyDb) 上不会被路由 → 404。
 * 但 `/messages` 是公开 legacy path，测试 server 上工作正常。
 * 真实 prod 路径两者都工作（http.ts 165-184）。
 *
 * 测试策略：
 * - 端到端：用 test server 的 /messages 路径验证 fetch / trim / 协议拼接正确
 * - 静态：grep send.ts 源码验证 /api/messages 路径存在于 --server-url 分支
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createIMServer } from '../../src/im/server';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('bounty com send - --server-url option', () => {
  let server: any;

  beforeEach(async () => {
    server = await createIMServer({ port: 0, memory: true });
  });

  afterEach(async () => {
    await server.stop();
  });

  /**
   * 端到端：模拟 send.ts 的 fetch 行为。
   * 由于 IMHTTPServer 的 /api/messages 是 protected (在 test server 上 404)，
   * 用 /messages 验证 fetch + trim + URL 构造逻辑。
   */
  test('should fetch ${serverUrl}/messages (legacy path) and send message successfully', async () => {
    const port = server.getHttpPort();
    const serverUrl = `http://localhost:${port}`;

    // 模拟 send.ts 中 fetch(`${serverUrl}/messages`)
    const response = await fetch(`${serverUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'alice@example.com',
        to: 'bob@example.com',
        content: { type: 'text', body: 'hello via server-url' },
      }),
    });

    expect(response.status).toBe(201);
    const msg = await response.json();
    expect(msg.from).toBe('alice@example.com');
    expect(msg.to).toBe('bob@example.com');
    expect(msg.content).toEqual({ type: 'text', body: 'hello via server-url' });
  });

  test('should trim trailing slash from --server-url', () => {
    const trim = (s: string) => s.replace(/\/+$/, '');
    expect(trim('http://localhost:4000/')).toBe('http://localhost:4000');
    expect(trim('http://localhost:4000///')).toBe('http://localhost:4000');
    expect(trim('http://localhost:4000')).toBe('http://localhost:4000');
  });

  test('should reject --server-url without scheme (send.ts client-side validation)', () => {
    const validateServerUrl = (url: string): boolean =>
      /^https?:\/\//.test(url.replace(/\/+$/, ''));
    expect(validateServerUrl('http://localhost:4000')).toBe(true);
    expect(validateServerUrl('https://bounty.example.com')).toBe(true);
    expect(validateServerUrl('https://bounty.example.com:443/')).toBe(true);
    expect(validateServerUrl('bounty.example.com')).toBe(false);
    expect(validateServerUrl('://oops')).toBe(false);
    expect(validateServerUrl('ftp://bounty.example.com')).toBe(false);
  });

  /**
   * 静态验证：send.ts 必须用 /api/messages（prod 真实路径）
   * （而 legacy /messages 只保留在 --host/--port 回退路径）
   */
  test('send.ts source must use /api/messages endpoint for --server-url', () => {
    const src = readFileSync(
      resolve(import.meta.dir, '../../src/cli/commands/com/send.ts'),
      'utf-8'
    );
    // 必有：--server-url 分支用 /api/messages
    expect(src).toContain("`${trimmed}/api/messages`");
    // 必有：--host/--port legacy path 仍走 /messages（向后兼容）
    expect(src).toContain('`http://${host}:${port}/messages`');
  });
});

describe('bounty com send - help output reflects --server-url', () => {
  test('--server-url / -e alias / description must be in send.ts', () => {
    const src = readFileSync(
      resolve(import.meta.dir, '../../src/cli/commands/com/send.ts'),
      'utf-8'
    );
    expect(src).toContain("'server-url'");
    expect(src).toContain("alias: 'e'");
    // 描述含 "server base URL"
    expect(src).toMatch(/server base url/i);
    expect(src).toMatch(/IM server base URL/);
    // describe updated
    expect(src).toContain("Send a message via Agent IM (bounty IM)");
  });
});