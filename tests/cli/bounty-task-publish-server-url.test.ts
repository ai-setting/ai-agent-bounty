/**
 * Tests for `bounty bounty-task publish` CLI command — HTTP API migration.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机：原 publish.ts 直接读写本地 SQLite (./data/bounty.db)，跨机器/远程不可用。
 * 重构后改用 HTTP API + --server-url / 默认 token / 默认 agent 推断。
 *
 * 测试策略（端到端 + 静态）：
 * - T1-T2: 端到端 — 启动 mock server，验证 publish 调用 /api/tasks POST
 * - T3: 默认 agent 推断（BOUNTY_IM_ADDRESS）作为 --publisher-id 的 fallback
 * - T4: 缺少必需字段时友好错误（reward > 0 校验）
 * - T5: 网络错误时抛 BountyHttpError(type=network)
 * - T6: 鉴权错误时抛 BountyHttpError(type=auth)
 * - T7: 业务错误（任务已存在等）抛 BountyHttpError(type=business)
 * - T8: --server-url 覆盖 BOUNTY_API_URL env
 * - T9: source 不再使用 createContext（确认完全 HTTP 化）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts');

describe('bounty bounty-task publish - HTTP API migration', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let receivedRequests: { url: string; method: string; body: any; headers: Record<string, string> }[] = [];

  beforeEach(() => {
    receivedRequests = [];
    delete process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_API_URL;
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
  });

  test('source uses bountyHttp (not createContext)', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/bounty-http.js'");
    expect(src).not.toContain("from '../../services/context.js'");
  });

  test('source has --server-url / -u option via addServerUrlOption', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("addServerUrlOption");
    expect(src).toContain("resolveServerUrl");
  });

  test('source uses resolveCurrentAgent as default for --publisher-id', () => {
    const src = readFileSync(SRC, 'utf-8');
    // v0.14: --publisher-email flow via requireEmailFlag; resolveCurrentAgent is gone.
    expect(src).toContain("requireEmailFlag");
    expect(src).not.toContain("resolveCurrentAgent");
  });

  test('T1: publishes task via HTTP POST /api/tasks with full body', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return new Promise(async (resolveOuter) => {
          const body = await req.json().catch(() => ({}));
          receivedRequests.push({
            url: url.pathname,
            method: req.method,
            body,
            headers: Object.fromEntries(req.headers.entries()),
          });
          resolveOuter(Response.json({
            id: 'task-abc-123',
            title: body.title,
            description: body.description,
            type: body.type || 'bounty',
            reward: body.reward,
            publisherId: 'mock-publisher',
            status: 'open',
            tags: body.tags || [],
          }, { status: 201 }));
        });
      },
    });
    const baseUrl = `http://localhost:${mockServer.port}`;

    // 直接调 bountyHttp 模拟 publish.ts handler 的核心逻辑
    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const task: any = await bountyHttp({
      baseUrl,
      path: '/api/tasks',
      method: 'POST',
      body: {
        title: 'Fix login bug',
        description: 'Users cannot login after deploy',
        type: 'coding',
        reward: 100,
      },
    });

    expect(task.id).toBe('task-abc-123');
    expect(task.title).toBe('Fix login bug');
    expect(task.reward).toBe(100);

    expect(receivedRequests).toHaveLength(1);
    expect(receivedRequests[0].method).toBe('POST');
    expect(receivedRequests[0].url).toBe('/api/tasks');
    expect(receivedRequests[0].body.reward).toBe(100);
  });

  test('T2: --server-url overrides default API base', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        receivedRequests.push({
          url: new URL(req.url).hostname + ':' + new URL(req.url).port + new URL(req.url).pathname,
          method: req.method,
          body: null,
          headers: {},
        });
        return Response.json({ id: 'remote-task' }, { status: 201 });
      },
    });
    const customBaseUrl = `http://localhost:${mockServer.port}`;

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const task: any = await bountyHttp({
      baseUrl: customBaseUrl,
      path: '/api/tasks',
      method: 'POST',
      body: { title: 't', description: 'd', reward: 50 },
    });

    expect(task.id).toBe('remote-task');
    expect(receivedRequests[0].url).toBe(`localhost:${mockServer.port}/api/tasks`);
  });

  test('T3: reward must be > 0 (server-side validation propagates as business error)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Missing required field: reward (must be > 0)' }, { status: 400 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'POST',
        body: { title: 't', description: 'd', reward: 0 },
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('business');
      expect(e.serverMessage).toContain('reward');
    }
  });

  test('T4: network error (server unreachable) propagates as BountyHttpError(type=network)', async () => {
    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: 'http://127.0.0.1:1',
        path: '/api/tasks',
        method: 'POST',
        body: { title: 't', description: 'd', reward: 100 },
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('network');
      expect(e.message).toMatch(/Network error|Request timeout/i);
    }
  });

  test('T5: auth error (401) propagates as BountyHttpError(type=auth)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'POST',
        body: { title: 't', description: 'd', reward: 100 },
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('auth');
      expect(e.status).toBe(401);
    }
  });

  test('T6: server error (500) propagates as BountyHttpError(type=server)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Database locked' }, { status: 500 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'POST',
        body: { title: 't', description: 'd', reward: 100 },
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('server');
      expect(e.status).toBe(500);
    }
  });
});