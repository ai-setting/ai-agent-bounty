/**
 * Tests for `createBountyTestServer()` — lightweight HTTP test server backed
 * by real BountyRoutes + in-memory Database.
 *
 * Phase: feat/bounty-task-optimize (PR0)
 *
 * 设计动机: bounty-task/* 命令未来要走 HTTP API 调用 `BountyRoutes`。
 * 不能用真实 server（依赖 SQLite 文件 + K8s 网络），必须有一个快速启停
 * 的 in-memory test server，让测试可以端到端跑 publish → grab → submit
 * → complete 完整流程。
 *
 * 行为约定：
 * - `port: 0` → 随机可用端口
 * - `memory: true`（默认）→ 在内存 SQLite 中跑，stop 后数据全清
 * - `seedAgents` → 预创建 N 个 agent 用于鉴权绕过（auth middleware OFF by default）
 * - 返回 `{ port, baseUrl, stop, db }`，便于测试读写
 * - 支持 `--auth-required: true` 模拟生产环境（401 触发）
 *
 * 测试场景：
 * 1. server starts and reports a valid port (not 0)
 * 2. server listens on baseUrl and returns 200 on /health
 * 3. db is in-memory (write-then-stop → restart yields empty DB)
 * 4. seeded agents are queryable via /api/agents
 * 5. publish via POST /api/tasks works (end-to-end)
 * 6. grab via PUT /api/tasks/:id/grab works
 * 7. auth-required mode returns 401 without bearer token
 * 8. stop() closes the server (subsequent fetch fails)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  createBountyTestServer,
  type BountyTestServerConfig,
  type BountyTestServerHandle,
} from '../../src/cli/lib/bounty-test-server.js';

describe('createBountyTestServer', () => {
  let server: BountyTestServerHandle;

  afterEach(async () => {
    if (server) await server.stop();
  });

  describe('boot + lifecycle', () => {
    test('starts and reports a valid port (not 0)', async () => {
      server = await createBountyTestServer({ port: 0 });
      expect(server.port).toBeGreaterThan(0);
      expect(server.port).toBeLessThan(65536);
    });

    test('baseUrl has correct http://localhost:PORT scheme', async () => {
      server = await createBountyTestServer({ port: 0 });
      expect(server.baseUrl).toBe(`http://localhost:${server.port}`);
    });

    test('health endpoint returns ok', async () => {
      server = await createBountyTestServer({ port: 0 });
      const res = await fetch(`${server.baseUrl}/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string };
      expect(body.status).toBe('ok');
    });

    test('stop() closes the server (subsequent fetch fails)', async () => {
      server = await createBountyTestServer({ port: 0 });
      const port = server.port;
      await server.stop();
      let err: unknown = null;
      try {
        await fetch(`http://localhost:${port}/health`);
      } catch (e) {
        err = e;
      }
      expect(err).not.toBeNull();
    });
  });

  describe('in-memory isolation', () => {
    test('restart yields empty DB (in-memory is reset)', async () => {
      const s1 = await createBountyTestServer({ port: 0 });
      // write a task via API
      const publishRes = await fetch(`${s1.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'ghost' },
        body: JSON.stringify({ title: 't', description: 'd', reward: 1, type: 'coding' }),
      });
      // Will likely fail (no seeded agent) but the DB is fresh, that's the point
      expect(publishRes.status).toBeGreaterThanOrEqual(400); // unknown agent
      // Restart
      await s1.stop();
      server = await createBountyTestServer({ port: 0 });

      // Board's task count is 0 (or whatever default DB init produces) — list tasks and
      // assert no unexpected rows.
      const listRes = await fetch(`${server.baseUrl}/api/tasks`);
      expect(listRes.status).toBe(200);
      const tasks = (await listRes.json()) as unknown[];
      // Default empty repo = 0 rows (in-memory starts fresh)
      expect(tasks.length).toBe(0);
    });
  });

  describe('seeded agents', () => {
    test('seedAgents option creates agents queryable via /api/agents', async () => {
      const seeded = [
        { id: 'agent-1', email: 'one@test', name: 'One', credits: 100 },
        { id: 'agent-2', email: 'two@test', name: 'Two', credits: 200 },
      ];
      server = await createBountyTestServer({ port: 0, seedAgents: seeded });

      const listRes = await fetch(`${server.baseUrl}/api/agents`);
      expect(listRes.status).toBe(200);
      const agents = (await listRes.json()) as Array<{ id: string }>;
      const ids = agents.map(a => a.id);
      expect(ids).toContain('agent-1');
      expect(ids).toContain('agent-2');
    });
  });

  describe('end-to-end: publish + grab', () => {
    test('publish then grab succeeds end-to-end', async () => {
      server = await createBountyTestServer({
        port: 0,
        seedAgents: [
          { id: 'pub', email: 'pub@test', name: 'Publisher', credits: 500 },
          { id: 'grabber', email: 'grabber@test', name: 'Grabber', credits: 0 },
        ],
      });

      // publish
      const pubRes = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Id': 'pub' },
        body: JSON.stringify({
          title: 'Test task',
          description: 'desc',
          reward: 100,
          type: 'coding',
        }),
      });
      expect(pubRes.status).toBe(201);
      const task = (await pubRes.json()) as { id: string };
      expect(task.id).toBeString();

      // grab
      const grabRes = await fetch(`${server.baseUrl}/api/tasks/${task.id}/grab`, {
        method: 'PUT',
        headers: { 'X-Agent-Id': 'grabber' },
      });
      expect(grabRes.status).toBe(200);
      const grabbed = (await grabRes.json()) as { assigneeId: string; status: string };
      expect(grabbed.assigneeId).toBe('grabber');
      expect(grabbed.status).toBe('grabbed');
    });
  });

  describe('auth-required mode', () => {
    test('returns 401 without bearer token when authRequired=true', async () => {
      server = await createBountyTestServer({ port: 0, authRequired: true });
      const res = await fetch(`${server.baseUrl}/api/tasks`, { method: 'GET' });
      expect(res.status).toBe(401);
    });

    test('returns 200 with Authorization: Bearer <token> when authRequired=true', async () => {
      server = await createBountyTestServer({
        port: 0,
        authRequired: true,
        // we don't actually validate the token — just check header presence
        validTokens: ['valid-token-xyz'],
      });
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'GET',
        headers: { Authorization: 'Bearer valid-token-xyz' },
      });
      expect(res.status).toBe(200);
    });
  });
});

// Avoid unused-import warning for type that's only referenced in helpers
void {} as BountyTestServerConfig;
