/**
 * Tests for the shared HTTP client wrapper used by bounty-task/* commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机：6 个 bounty-task 子命令都要发 HTTP 请求，每个重复拼 URL / header
 * / 错误处理太冗余。`bountyHttp()` 统一封装：
 *   - baseUrl 解析（--server-url > API_BASE > 默认 localhost:4000）
 *   - 自动从 ~/.config/bounty/token 读 JWT 加 Authorization header
 *   - 抛 BountyHttpError（带 status / type / friendlyMessage）
 *
 * 测试场景：
 * 1. 模块导出 bountyHttp 函数
 * 2. 拼出正确 URL（base + path）
 * 3. 自动添加 Authorization header 当 token 存在
 * 4. 不添加 Authorization header 当 token 不存在
 * 5. 网络错误（fetch reject）抛 BountyHttpError(type=network）
 * 6. HTTP 4xx 抛 BountyHttpError(type=auth for 401/403, type=business for 400/404)
 * 7. HTTP 5xx 抛 BountyHttpError(type=server)
 * 8. timeout（可选 abort controller）抛 BountyHttpError(type=network, reason=timeout)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('bountyHttp - HTTP client wrapper', () => {
  let tempDir: string;
  let tokenPath: string;
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let receivedRequests: { url: string; method: string; headers: Record<string, string>; body: any }[] = [];

  beforeEach(() => {
    receivedRequests = [];
    tempDir = join(tmpdir(), `bounty-http-test-${Date.now()}-${Math.random()}`);
    mkdirSync(tempDir, { recursive: true });
    tokenPath = join(tempDir, 'token');
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  test('exports bountyHttp function and BountyHttpError class', async () => {
    const mod = await import('../../src/cli/lib/bounty-http.js');
    expect(typeof mod.bountyHttp).toBe('function');
    expect(typeof mod.BountyHttpError).toBe('function');
  });

  test('constructs URL from base + path and sends POST with JSON body', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        receivedRequests.push({
          url: url.pathname + url.search,
          method: req.method,
          headers: Object.fromEntries(req.headers.entries()),
          body: null,
        });
        return Response.json({ ok: true, path: url.pathname });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result = await bountyHttp({
      baseUrl,
      path: '/api/tasks',
      method: 'POST',
      body: { title: 't', description: 'd', reward: 100 },
      tokenPath,
    });

    expect(result).toEqual({ ok: true, path: '/api/tasks' });
    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/tasks');
    expect(receivedRequests[0].headers['content-type']).toContain('application/json');
  });

  test('auto-attaches Authorization Bearer header when token file exists', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        receivedRequests.push({
          url: new URL(req.url).pathname,
          method: req.method,
          headers: Object.fromEntries(req.headers.entries()),
          body: null,
        });
        return Response.json({ ok: true });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;
    writeFileSync(tokenPath, 'jwt-test-token-12345', 'utf-8');

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({
      baseUrl,
      path: '/api/tasks',
      method: 'POST',
      body: {},
      tokenPath,
    });

    expect(receivedRequests[0].headers['authorization']).toBe('Bearer jwt-test-token-12345');
  });

  test('does NOT attach Authorization header when no token file', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        receivedRequests.push({
          url: new URL(req.url).pathname,
          method: req.method,
          headers: Object.fromEntries(req.headers.entries()),
          body: null,
        });
        return Response.json({ ok: true });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;
    expect(existsSync(tokenPath)).toBe(false);

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({
      baseUrl,
      path: '/api/tasks',
      method: 'GET',
      tokenPath,
    });

    expect(receivedRequests[0].headers['authorization']).toBeUndefined();
  });

  test('network error (connection refused) throws BountyHttpError(type=network)', async () => {
    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');

    // Port 1 is reserved/unbound → fetch will reject
    try {
      await bountyHttp({
        baseUrl: 'http://127.0.0.1:1',
        path: '/api/tasks',
        method: 'GET',
        tokenPath,
      });
      expect(true).toBe(false); // should have thrown
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('network');
      expect(e.status).toBe(0);
      expect(e.message).toContain('Network error');
    }
  });

  test('HTTP 401 throws BountyHttpError(type=auth)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({ baseUrl, path: '/api/tasks', method: 'GET', tokenPath });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('auth');
      expect(e.status).toBe(401);
      expect(e.message).toContain('Authentication required');
    }
  });

  test('HTTP 403 throws BountyHttpError(type=auth)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({ baseUrl, path: '/api/tasks/abc/cancel', method: 'PUT', tokenPath });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('auth');
      expect(e.status).toBe(403);
    }
  });

  test('HTTP 400 throws BountyHttpError(type=business, message from server)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: 'reward must be > 0' }), { status: 400 });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({ baseUrl, path: '/api/tasks', method: 'POST', body: {}, tokenPath });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('business');
      expect(e.status).toBe(400);
      expect(e.serverMessage).toBe('reward must be > 0');
      expect(e.message).toContain('reward must be > 0');
    }
  });

  test('HTTP 404 throws BountyHttpError(type=business)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: 'Task not found' }), { status: 404 });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({ baseUrl, path: '/api/tasks/missing', method: 'GET', tokenPath });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('business');
      expect(e.status).toBe(404);
    }
  });

  test('HTTP 500 throws BountyHttpError(type=server)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({ baseUrl, path: '/api/tasks', method: 'GET', tokenPath });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('server');
      expect(e.status).toBe(500);
    }
  });

  test('base URL with trailing slash is auto-trimmed', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        receivedRequests.push({
          url: new URL(req.url).pathname,
          method: req.method,
          headers: {},
          body: null,
        });
        return Response.json({ ok: true });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}/`;

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({ baseUrl, path: '/api/tasks', method: 'GET', tokenPath });

    expect(receivedRequests[0].url).toBe('/api/tasks');
    expect(receivedRequests[0].url).not.toContain('//api');
  });

  test('path without leading slash is normalized to start with /', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        receivedRequests.push({
          url: new URL(req.url).pathname,
          method: req.method,
          headers: {},
          body: null,
        });
        return Response.json({ ok: true });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({ baseUrl, path: 'api/tasks', method: 'GET', tokenPath });

    expect(receivedRequests[0].url).toBe('/api/tasks');
  });
});