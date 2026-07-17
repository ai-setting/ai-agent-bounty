/**
 * Tests for v0.10 strict address-based API in BountyRoutes.
 *
 * v0.10 BREAKING:
 * - Only `<uuid>@<host>` accepted in body `publisherAddress` / `agentAddress`
 * - Bare UUID 拒绝 — server now returns 400 "Agent not found"
 * - 容错 (missing description / reward, bad reward / result) unchanged
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
    '8de9b6aa-1111-4000-8000-000000000001', 'PubAlice', 'pub@example.com',
    '8de9b6aa-1111-4000-8000-000000000001@bounty.local', now, now
  );
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-2222-4000-8000-000000000002', 'AgentBob', 'agent@example.com',
    '8de9b6aa-2222-4000-8000-000000000002@bounty.local', now, now
  );
  return db;
}

const PUB_FULL = '8de9b6aa-1111-4000-8000-000000000001@bounty.local';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';
const AGENT_FULL = '8de9b6aa-2222-4000-8000-000000000002@bounty.local';
const AGENT_UUID = '8de9b6aa-2222-4000-8000-000000000002';

describe('BountyRoutes — address-based API (v0.10 strict)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    // PR4: token check defaults to ON. These tests exercise the soft-auth
    // (token check OFF) path — opt out explicitly.
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';
    bountyDb = makeBountyDb();
    imDb = new IMDatabase({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
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
        publisherAddress: PUB_FULL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe(PUB_UUID);
    expect(task.status).toBe('open');
  });

  test('v0.10 BREAKING: createTask 拒绝 bare UUID publisherAddress — 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        publisherAddress: PUB_UUID,  // bare UUID — REJECTED in v0.10
      }),
    });
    // bare UUID 不再 fallback — server 视为找不到 agent (400)
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  test('createTask 找不到 publisherAddress → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        publisherAddress: '00000000-0000-4000-8000-000000000000@nowhere.local',
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
        publisherAddress: PUB_FULL,
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
        publisherAddress: PUB_FULL,
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
        publisherAddress: PUB_FULL,
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
        publisherAddress: PUB_FULL,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('reward');
  });

  // ===== grabTask =====

  test('grabTask 接受 agentAddress 完整地址 (无 Authorization 头)', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });
    expect(grab.status).toBe(200);
    const updated = (await grab.json()) as { assigneeId: string; status: string };
    expect(updated.assigneeId).toBe(AGENT_UUID);
    expect(updated.status).toBe('grabbed');
  });

  test('v0.10 BREAKING: grabTask 拒绝 bare UUID agentAddress → 400', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_UUID }),  // bare UUID — REJECTED
    });
    expect(grab.status).toBe(400);
    const body = (await grab.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  test('grabTask 找不到 agentAddress → 400', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: '00000000-0000-4000-8000-000000000099@nowhere.local' }),
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
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL, result: 'All done!' }),
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
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),  // missing result
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
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });

    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL, result: '   ' }),  // whitespace only
    });
    expect(sub.status).toBe(400);
  });

  // ===== completeTask =====

  test('completeTask 接受 publisherAddress 完整地址', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });
    await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL, result: 'done' }),
    });

    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: PUB_FULL }),
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
        publisherAddress: PUB_FULL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: AGENT_FULL }),  // not publisher
    });
    expect(complete.status).toBe(403);
  });
});
