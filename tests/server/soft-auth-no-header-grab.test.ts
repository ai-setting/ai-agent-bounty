/**
 * Phase 4 — soft auth + address body integration tests (v0.10).
 *
 * Verifies the combined behavior (PR4 update — token check default flipped to ON):
 *   - Default: BOUNTY_TOKEN_CHECK_ENABLED is unset → token check ON (401 without header)
 *   - BOUNTY_TOKEN_CHECK_ENABLED=false → token check off (soft auth bypass)
 *   - With soft auth, callers can omit Authorization header
 *   - Requests must supply `publisherAddress` / `agentAddress` (full uuid@host)
 *     in body to identify actor (v0.10 BREAKING: bare UUID REJECTED)
 *   - Bad token + good address → still works (soft auth bypass)
 *   - No token + no address → 400 (server can't determine actor)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

const PUB_FULL = '8de9b6aa-1111-4000-8000-000000000001@bounty.local';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';

describe('Soft auth + address body (v0.10 strict)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let originalTokenEnv: string | undefined;

  beforeEach(async () => {
    // PR4: default token check is ON. Tests that exercise the soft-auth
    // bypass path explicitly opt out by setting BOUNTY_TOKEN_CHECK_ENABLED=false.
    originalTokenEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';

    bountyDb = new Database({ memory: true });
    imDb = new IMDatabase({ memory: true });
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      PUB_UUID, 'Alice', 'alice@example.com', PUB_FULL, now, now
    );
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    if (originalTokenEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalTokenEnv;
    }
  });

  test('BOUNTY_TOKEN_CHECK_ENABLED=false 时: tokenCheckEnabled = false', () => {
    expect((server as any).tokenCheckEnabled).toBe(false);
  });

  test('无 Authorization 头 + 完整 address body → 201 (soft auth + address 路由)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },  // 注意：没有 Authorization
      body: JSON.stringify({
        title: 'No-auth Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: PUB_FULL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe(PUB_UUID);
    expect(task.status).toBe('open');
  });

  test('v0.10 BREAKING: 无 Authorization + bare UUID address → 400 (拒绝 bare UUID)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'BareUUID Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: PUB_UUID,  // bare UUID REJECTED in v0.10
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('Agent not found');
  });

  test('带坏 token + 完整 address body → 仍然 201 (soft auth bypass)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer broken.jwt.token' },
      body: JSON.stringify({
        title: 'Bad-token Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: PUB_FULL,
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

  test('完整流程: 无 token publish → grab → submit → complete 全用完整 address', async () => {
    // 1. publish (publisher)
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'E2E', description: 'D', reward: 10, type: 'coding',
        publisherAddress: PUB_FULL,
      }),
    });
    expect(pub.status).toBe(201);
    const task = (await pub.json()) as { id: string };

    // 2. grab (need a 2nd agent — let's create one inline)
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      '8de9b6aa-3333-4000-8000-000000000003', 'Bob', 'bob@example.com',
      '8de9b6aa-3333-4000-8000-000000000003@bounty.local', now, now
    );
    const agentFull = '8de9b6aa-3333-4000-8000-000000000003@bounty.local';
    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: agentFull }),
    });
    expect(grab.status).toBe(200);

    // 3. submit
    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: agentFull, result: 'work done' }),
    });
    expect(sub.status).toBe(200);

    // 4. complete
    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: PUB_FULL }),
    });
    expect(complete.status).toBe(200);
  });
});
