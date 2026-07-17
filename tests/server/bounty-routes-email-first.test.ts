/**
 * v0.13: Tests for email-first BountyRoutes API.
 *
 * v0.13 changes:
 *   - Server endpoints accept `*Email` (agents.email UNIQUE column) as the
 *     PRIMARY lookup key. `*Address` (`<uuid>@<host>`) is preserved as a
 *     secondary lookup for callers that have not yet migrated.
 *
 * Test matrix:
 *   - createTask accepts publisherEmail → 201, publisherId matches agent.id
 *   - createTask accepts publisherAddress (legacy) → 201, backward compat
 *   - createTask with NEITHER → 400
 *   - createTask with email that doesn't exist → 400 "Agent not found"
 *   - grabTask accepts agentEmail → 200, assigneeId matches
 *   - grabTask accepts agentAddress (legacy) → 200, backward compat
 *   - grabTask with NEITHER → 400
 *   - submitTask accepts agentEmail → 200
 *   - email lookup takes priority over address lookup when both could match
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

function makeBountyDb(): Database {
  const db = new Database({ memory: true });
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-1111-4000-8000-000000000001',
    'PubAlice',
    'pub-alice@example.com',
    '8de9b6aa-1111-4000-8000-000000000001@bounty.local',
    now,
    now
  );
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-2222-4000-8000-000000000002',
    'AgentBob',
    'agent-bob@example.com',
    '8de9b6aa-2222-4000-8000-000000000002@bounty.local',
    now,
    now
  );
  return db;
}

const PUB_EMAIL = 'pub-alice@example.com';
const PUB_FULL = '8de9b6aa-1111-4000-8000-000000000001@bounty.local';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';
const AGENT_EMAIL = 'agent-bob@example.com';
const AGENT_FULL = '8de9b6aa-2222-4000-8000-000000000002@bounty.local';
const AGENT_UUID = '8de9b6aa-2222-4000-8000-000000000002';

describe('BountyRoutes — email-first API (v0.13)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    // Soft-auth mode: token check OFF so we can pass publisher/agent in body.
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

  test('createTask 接受 publisherEmail（v0.13 primary）→ 201', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T-email',
        description: 'D-email',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe(PUB_UUID);
    expect(task.status).toBe('open');
  });

  test('createTask publisherAddress 仍可用（v0.10 legacy 兼容）', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T-addr',
        description: 'D-addr',
        reward: 10,
        type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string };
    expect(task.publisherId).toBe(PUB_UUID);
  });

  test('createTask 缺 publisherEmail/publisherAddress → 400', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T-missing',
        description: 'D',
        reward: 10,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    // v0.13 wording: must mention email
    expect(body.error.toLowerCase()).toContain('email');
  });

  test('createTask publisherEmail 不存在 → 400 Agent not found', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T-noone',
        description: 'D',
        reward: 10,
        publisherEmail: 'noone@example.com',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  // ===== grabTask =====

  test('grabTask 接受 agentEmail → 200, assigneeId 匹配', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });
    expect(grab.status).toBe(200);
    const updated = (await grab.json()) as { assigneeId: string; status: string };
    expect(updated.assigneeId).toBe(AGENT_UUID);
    expect(updated.status).toBe('grabbed');
  });

  test('grabTask agentAddress 仍可用（legacy 兼容）', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });
    expect(grab.status).toBe(200);
    const updated = (await grab.json()) as { assigneeId: string };
    expect(updated.assigneeId).toBe(AGENT_UUID);
  });

  test('grabTask 缺 agentEmail/agentAddress → 400', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(grab.status).toBe(400);
    const body = (await grab.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('email');
  });

  // ===== submitTask =====

  test('submitTask 接受 agentEmail → 200', async () => {
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });
    expect(grab.status).toBe(200);

    const submit = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentEmail: AGENT_EMAIL,
        result: 'I did the thing',
      }),
    });
    expect(submit.status).toBe(200);
    const updated = (await submit.json()) as { status: string };
    expect(updated.status).toBe('submitted');
  });

  // ===== priority test =====

  test('email 优先于 address：当两个字段都提供时用 email', async () => {
    // Bob 的 email 是 agent-bob@example.com；用一个不同的 address 也不应被采纳
    // 这里我们传一个不存在的 address + 正确的 email，应当走 email 路径
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T', description: 'D', reward: 5, type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pub.json()) as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentEmail: AGENT_EMAIL,
        agentAddress: '00000000-0000-4000-8000-000000000000@bounty.local',
      }),
    });
    expect(grab.status).toBe(200);
    const updated = (await grab.json()) as { assigneeId: string };
    // The legitimate agent wins via email path
    expect(updated.assigneeId).toBe(AGENT_UUID);
  });
});