/**
 * Tests for v0.7 address-based API in BountyRoutes.
 *
 * Covers:
 * - createTask 接受 publisherAddress (full address + bare UUID)
 * - createTask 容错 (missing description → 400, missing reward → 400, invalid reward → 400)
 * - grabTask 接受 agentAddress (body)
 * - grabTask 找不到 agentAddress → 400
 * - submitTask 接受 agentAddress + result 容错
 * - completeTask 接受 publisherAddress
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

/** Build a fully-schema-initialized bounty DB and seed two agents. */
function makeBountyDb(): Database {
  const db = new Database({ memory: true });
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    'pub-uuid-1', 'PubAlice', 'pub@example.com', 'pub-uuid-1@bounty.local', now, now
  );
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    'agent-uuid-1', 'AgentBob', 'agent@example.com', 'agent-uuid-1@bounty.local', now, now
  );
  return db;
}

describe('BountyRoutes — address-based API (v0.7)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    // 默认关闭 token check (v0.7 软鉴权默认)
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    bountyDb = makeBountyDb();
    imDb = new IMDatabase({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
  });

  // ===== createTask =====

  test('createTask 接受 publisherAddress 完整地址', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        type: 'coding',
        publisherAddress: 'pub-uuid-1@bounty.local',
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe('pub-uuid-1');
    expect(task.status).toBe('open');
  });

  test('createTask 接受 publisherAddress 纯 UUID (向后兼容)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        publisherAddress: 'pub-uuid-1',  // bare UUID
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string };
    expect(task.publisherId).toBe('pub-uuid-1');
  });

  test('createTask 找不到 publisherAddress → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        publisherAddress: 'nonexistent-uuid@nowhere.local',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  test('createTask 缺 description → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        reward: 10,
        publisherAddress: 'pub-uuid-1',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('description');
  });

  test('createTask 缺 reward → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('reward');
  });

  test('createTask reward 是非正数 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 0,
        publisherAddress: 'pub-uuid-1',
      }),
    });
    expect(res.status).toBe(400);
  });

  test('createTask reward 是 string → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 'abc',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('reward');
  });

  // ===== grabTask =====

  test('grabTask 接受 agentAddress 完整地址 (无 Authorization 头)', async () => {
    // 1. publish a task
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1@bounty.local',
      }),
    });
    const task = (await pub.json()) as { id: string };

    // 2. grab with agentAddress (no Authorization header — soft auth)
    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1@bounty.local' }),
    });
    expect(grab.status).toBe(200);
    const updated = (await grab.json()) as { assigneeId: string; status: string };
    expect(updated.assigneeId).toBe('agent-uuid-1');
    expect(updated.status).toBe('grabbed');
  });

  test('grabTask 找不到 agentAddress → 400', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'nope@nowhere.local' }),
    });
    expect(grab.status).toBe(400);
    const body = (await grab.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  // ===== submitTask =====

  test('submitTask 接受 agentAddress + result', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1' }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1@bounty.local', result: 'All done!' }),
    });
    expect(sub.status).toBe(200);
    const updated = (await sub.json()) as { status: string; result: string };
    expect(updated.status).toBe('submitted');
    expect(updated.result).toBe('All done!');
  });

  test('submitTask result 缺失 → 400 (容错)', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1' }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1' }),  // missing result
    });
    expect(sub.status).toBe(400);
    const body = (await sub.json()) as { error: string };
    expect(body.error).toContain('result');
  });

  test('submitTask result 为空字符串 → 400', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1' }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1', result: '   ' }),  // whitespace only
    });
    expect(sub.status).toBe(400);
  });

  // ===== completeTask =====

  test('completeTask 接受 publisherAddress', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1' }),
    });
    await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: 'agent-uuid-1', result: 'done' }),
    });

    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: 'pub-uuid-1@bounty.local' }),
    });
    expect(complete.status).toBe(200);
    const updated = (await complete.json()) as { status: string };
    expect(updated.status).toBe('completed');
  });

  test('completeTask 非 publisher 调用 → 403', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: 'pub-uuid-1',
      }),
    });
    const task = (await pub.json()) as { id: string };

    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: 'agent-uuid-1@bounty.local' }),  // not publisher
    });
    expect(complete.status).toBe(403);
  });
});