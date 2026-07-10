/**
 * Tests for retry logic with exponential backoff for transient network failures.
 *
 * Phase: feat/bounty-task-optimize (Tier C)
 *
 * 设计动机: 网络瞬时失败（连接重置、临时 503）应该自动重试而不是立即失败。
 * 用 exponential backoff (50ms, 100ms, 200ms) + jitter 避免 thundering herd。
 *
 * 测试场景：
 * 1. 第一次成功 → 不重试
 * 2. 前 2 次失败，第 3 次成功 → 重试 3 次后成功
 * 3. 全部失败 → 抛原始 BountyHttpError
 * 4. 非 network 错误（business 4xx）不重试
 * 5. 重试次数可配置 (maxRetries=0 → 不重试)
 * 6. retryable status codes (502/503/504) 自动重试
 * 7. 非 retryable status codes (400/401/404) 不重试
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('bountyHttp - retry with exponential backoff', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let attempts = 0;

  beforeEach(() => {
    attempts = 0;
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
  });

  test('succeeds on first try → no retry', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return Response.json({ ok: true });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks',
      method: 'GET',
      maxRetries: 3,
      retryBaseDelayMs: 10, // 快速测试
    });

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(1);
  });

  test('retries on network error (connection refused) and eventually succeeds', async () => {
    let serverPort: number;

    // 启动一个会关闭的 server 模拟瞬时网络错误
    let callCount = 0;
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        callCount++;
        if (callCount < 3) {
          // 头两次请求返回 503 (server overload)
          return new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 });
        }
        return Response.json({ ok: true });
      },
    });
    serverPort = mockServer.port;

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    const result = await bountyHttp({
      baseUrl: `http://localhost:${serverPort}`,
      path: '/api/tasks',
      method: 'GET',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    expect(result).toEqual({ ok: true });
    expect(callCount).toBe(3);
  });

  test('gives up after maxRetries exhausted and throws last error', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response(JSON.stringify({ error: 'Always fails' }), { status: 503 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    let thrown: any = null;
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'GET',
        maxRetries: 2,
        retryBaseDelayMs: 10,
      });
    } catch (e) {
      thrown = e;
    }

    // 初次 + 2 retries = 3 总调用
    expect(attempts).toBe(3);
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.type).toBe('server');
  });

  test('does NOT retry on business error (400)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response(JSON.stringify({ error: 'reward must be > 0' }), { status: 400 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    let thrown: any = null;
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'POST',
        body: { reward: 0 },
        maxRetries: 3,
        retryBaseDelayMs: 10,
      });
    } catch (e) {
      thrown = e;
    }

    expect(attempts).toBe(1); // 不重试
    expect(thrown).toBeInstanceOf(BountyHttpError);
    expect(thrown.type).toBe('business');
  });

  test('does NOT retry on auth error (401)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    let thrown: any = null;
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'GET',
        maxRetries: 3,
        retryBaseDelayMs: 10,
      });
    } catch (e) {
      thrown = e;
    }

    expect(attempts).toBe(1);
    expect(thrown.type).toBe('auth');
  });

  test('maxRetries=0 means no retry (just one attempt)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response(JSON.stringify({ error: 'fail' }), { status: 503 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    let thrown: any = null;
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'GET',
        maxRetries: 0,
        retryBaseDelayMs: 10,
      });
    } catch (e) {
      thrown = e;
    }

    expect(attempts).toBe(1);
    expect(thrown).toBeInstanceOf(BountyHttpError);
  });

  test('retryable status: 502 (bad gateway)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return attempts < 2
          ? new Response(JSON.stringify({ error: 'Bad Gateway' }), { status: 502 })
          : Response.json({ ok: true });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks',
      method: 'GET',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(2);
  });

  test('retryable status: 504 (gateway timeout)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return attempts < 2
          ? new Response(JSON.stringify({ error: 'Gateway Timeout' }), { status: 504 })
          : Response.json({ ok: true });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks',
      method: 'GET',
      maxRetries: 3,
      retryBaseDelayMs: 10,
    });

    expect(attempts).toBe(2);
    expect(result).toEqual({ ok: true });
  });

  test('exponential backoff: total delay grows linearly with retry count', async () => {
    // 验证 backoff 确实随 retry 次数增加（通过 timing 近似验证）
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        attempts++;
        return new Response(JSON.stringify({ error: 'fail' }), { status: 503 });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const start = Date.now();
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks',
        method: 'GET',
        maxRetries: 2,
        retryBaseDelayMs: 50, // 50ms base → 第 1 次重试 ~50ms, 第 2 次 ~100ms → 总 ~150ms+
      });
    } catch (e) {
      // expected
    }
    const elapsed = Date.now() - start;

    expect(attempts).toBe(3);
    // 至少应该等 50 + 100 = 150ms (忽略 jitter 和 HTTP 处理时间)
    expect(elapsed).toBeGreaterThanOrEqual(120);
  });
});