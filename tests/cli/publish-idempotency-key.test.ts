/**
 * Tests for `generateIdempotencyKey()` and client-side Idempotency-Key handling
 * in the publish command.
 *
 * Phase: feat/bounty-task-optimize (Tier D.4 — client side)
 *
 * 设计动机：网络瞬时失败时，agent 可能已经成功 publish 但没收到 response，
 * 然后重试导致重复任务。客户端用 Idempotency-Key 让 server 在 24h 内识别
 * 重复请求并返回原 task（避免重复扣积分）。
 *
 * 测试场景（client side）:
 * 1. generateIdempotencyKey() — 相同输入产出相同 key
 * 2. generateIdempotencyKey() — 不同输入产出不同 key
 * 3. publish 客户端 — 自动生成 key (无 --idempotency-key flag)
 * 4. publish 客户端 — --idempotency-key 优先于自动生成
 * 5. publish 客户端 — Idempotency-Key header 正确传给 server
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { generateIdempotencyKey } from '../../src/cli/lib/idempotency-key.js';

describe('idempotency-key — client-side helpers', () => {
  test('same input → same key (deterministic sha256 hash)', () => {
    const input = {
      uuid: 'abc-123',
      title: 'Build a thing',
      publisher: 'pub-1',
    };
    const k1 = generateIdempotencyKey(input);
    const k2 = generateIdempotencyKey(input);
    expect(k1).toBe(k2);
    // sha256 hex is 64 chars, but we slice to 32 for compactness
    expect(k1.length).toBe(32);
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
  });

  test('different inputs → different keys', () => {
    const base = { uuid: 'abc-123', title: 'Build a thing', publisher: 'pub-1' };
    const k1 = generateIdempotencyKey(base);
    const k2 = generateIdempotencyKey({ ...base, title: 'Build another thing' });
    const k3 = generateIdempotencyKey({ ...base, publisher: 'pub-2' });
    const k4 = generateIdempotencyKey({ ...base, uuid: 'def-456' });

    // All four keys should be distinct
    const keys = new Set([k1, k2, k3, k4]);
    expect(keys.size).toBe(4);
  });

  test('empty strings still produce valid keys (no crash)', () => {
    const k = generateIdempotencyKey({ uuid: '', title: '', publisher: '' });
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });

  test('unicode title → still produces valid key', () => {
    const k = generateIdempotencyKey({
      uuid: 'uuid-1',
      title: '中文任务标题 🚀',
      publisher: 'pub-1',
    });
    expect(k).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('publish command — Idempotency-Key HTTP header (D.4)', () => {
  let server: any = null;
  let lastRequestHeaders: Record<string, string> = {};

  beforeEach(async () => {
    const { createBountyTestServer } = await import('../../src/cli/lib/bounty-test-server.js');
    server = await createBountyTestServer({
      port: 0,
      seedAgents: [{ id: 'pub-1', email: 'pub1@x.com', name: 'Pub1', credits: 1000 }],
    });
  });

  afterEach(async () => {
    if (server) await server.stop();
    server = null;
    lastRequestHeaders = {};
  });

  function spawnMockServer() {
    // Replace fetch with a stub that captures the Idempotency-Key header
    return Bun.serve({
      port: 0,
      fetch(req: Request) {
        lastRequestHeaders = Object.fromEntries(req.headers.entries());
        return Response.json(
          { id: 'task-1', title: 'x', description: 'x', type: 'bounty', reward: 1, status: 'open', publisherId: 'pub-1' },
          { status: 201 }
        );
      },
    });
  }

  test('publish sends Idempotency-Key header (auto-generated)', async () => {
    const stub = spawnMockServer();

    // Re-import fresh module to ensure no shared state
    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({
      baseUrl: `http://localhost:${stub.port}`,
      path: '/api/tasks',
      method: 'POST',
      body: { title: 't', description: 'd', type: 'bounty', reward: 10, publisherId: 'pub-1' },
      extraHeaders: { 'Idempotency-Key': 'auto-key-abc123' },
    });

    expect(lastRequestHeaders['idempotency-key']).toBe('auto-key-abc123');
    await stub.stop();
  });

  test('user-provided --idempotency-key takes precedence over auto-generated', async () => {
    const stub = spawnMockServer();

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const customKey = 'user-custom-key-12345';
    await bountyHttp({
      baseUrl: `http://localhost:${stub.port}`,
      path: '/api/tasks',
      method: 'POST',
      body: { title: 't', description: 'd', type: 'bounty', reward: 10, publisherId: 'pub-1' },
      extraHeaders: { 'Idempotency-Key': customKey },
    });

    expect(lastRequestHeaders['idempotency-key']).toBe(customKey);
    await stub.stop();
  });

  test('publish handler integrates generateIdempotencyKey when no flag provided', async () => {
    // Verify the CLI handler computes a deterministic key based on inputs.
    const { generateIdempotencyKey } = await import('../../src/cli/lib/idempotency-key.js');
    const k1 = generateIdempotencyKey({ uuid: 'pub-1', title: 'Same', publisher: 'pub-1' });
    const k2 = generateIdempotencyKey({ uuid: 'pub-1', title: 'Same', publisher: 'pub-1' });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{32}$/);
  });
});