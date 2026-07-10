/**
 * Phase 4 — soft auth + address body integration tests.
 *
 * Verifies the combined behavior:
 *   - Default: BOUNTY_TOKEN_CHECK_ENABLED is unset → token check off
 *   - With soft auth, callers can omit Authorization header
 *   - Requests must supply `publisherAddress`/`agentAddress` in body to identify actor
 *   - Bad token + good address → still works (soft auth bypass)
 *   - No token + no address → 400 (server can't determine actor)
 *
 * Phase: feat/bounty-task-optimize v0.7
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

describe('Soft auth + address body (v0.7)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    bountyDb = new Database({ memory: true });
    imDb = new IMDatabase({ memory: true });
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'uuid-1', 'Alice', 'alice@example.com', 'uuid-1@bounty.local', now, now
    );
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => server.stop());

  test('默认 (env 未设): tokenCheckEnabled = false', () => {
    expect((server as any).tokenCheckEnabled).toBe(false);
  });

  test('无 Authorization 头 + address body → 201 (soft auth + address 路由)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },  // 注意：没有 Authorization
      body: JSON.stringify({
        title: 'No-auth Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: 'uuid-1@bounty.local',
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe('uuid-1');
    expect(task.status).toBe('open');
  });

  test('带坏 token + address body → 仍然 201 (soft auth bypass)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer broken.jwt.token' },
      body: JSON.stringify({
        title: 'Bad-token Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: 'uuid-1@bounty.local',
      }),
    });
    expect(res.status).toBe(201);
  });

  test('无 Authorization + 没 address body → 400 (无法定位 actor)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', description: 'D', reward: 1, type: 'writing' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('required');
  });

  test('GET /api/tasks 无 Authorization → 200 (list 是公开的)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as unknown[];
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('完整流程: 无 token publish → grab → submit → complete 全用 address', async () => {
    // 1. publish (publisher)
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'E2E', description: 'D', reward: 10, type: 'coding',
        publisherAddress: 'uuid-1@bounty.local',
      }),
    });
    expect(pub.status).toBe(201);
    const task = (await pub.json()) as { id: string };

    // 2. grab (need a 2nd agent — let's create one inline)
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      'uuid-2', 'Bob', 'bob@example.com', 'uuid-2@bounty.local', now, now
    );
    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'uuid-2@bounty.local' }),
    });
    expect(grab.status).toBe(200);

    // 3. submit
    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'uuid-2', result: 'work done' }),
    });
    expect(sub.status).toBe(200);

    // 4. complete
    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: 'uuid-1@bounty.local' }),
    });
    expect(complete.status).toBe(200);
    const final = (await complete.json()) as { status: string };
    expect(final.status).toBe('completed');
  });
});