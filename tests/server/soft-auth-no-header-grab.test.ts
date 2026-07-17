/**
 * Phase 4 — soft auth + email-only body integration tests (v0.14).
 *
 * Verifies the combined behavior:
 *   - Default: BOUNTY_TOKEN_CHECK_ENABLED is unset → token check ON (401 without header)
 *   - BOUNTY_TOKEN_CHECK_ENABLED=false → token check off (soft auth bypass)
 *   - With soft auth, callers can omit Authorization header
 *   - Requests must supply `publisherEmail` / `agentEmail` (registered email)
 *     in body to identify actor (v0.14 BREAKING: legacy *Address REJECTED 400)
 *   - Bad token + good email → still works (soft auth bypass)
 *   - No token + no email → 400 (server can't determine actor)
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

const PUB_EMAIL = 'alice@example.com';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';
const AGENT_EMAIL = 'bob@example.com';
const AGENT_UUID = '8de9b6aa-2222-4000-8000-000000000002';

describe('Soft auth + email-only body (v0.14 strict)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let originalTokenEnv: string | undefined;

  beforeEach(async () => {
    originalTokenEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';

    bountyDb = new Database({ memory: true });
    imDb = new IMDatabase({ memory: true });
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      PUB_UUID, 'Alice', PUB_EMAIL, `${PUB_UUID}@bounty.local`, now, now
    );
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      AGENT_UUID, 'Bob', AGENT_EMAIL, `${AGENT_UUID}@bounty.local`, now, now
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

  test('无 Authorization 头 + 完整 email body → 201 (soft auth + email 路由)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'No-auth Task', description: 'D', reward: 1, type: 'writing',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; status: string };
    expect(task.publisherId).toBe(PUB_UUID);
    expect(task.status).toBe('open');
  });

  test('v0.14: 无 Authorization + 任何 *Address body → 400 (legacy rejected)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'BareUUID Task', description: 'D', reward: 1, type: 'writing',
        publisherAddress: `${PUB_UUID}@bounty.local`,  // legacy rejected
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/use publisherEmail.*your-registered-email/i);
  });

  test('带坏 token + 完整 email body → 仍然 201 (soft auth bypass)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer broken.jwt.token' },
      body: JSON.stringify({
        title: 'Bad-token Task', description: 'D', reward: 1, type: 'writing',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(res.status).toBe(201);
  });

  test('无 Authorization + 没 email body → 400 (无法定位 actor)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'T', description: 'D', reward: 1, type: 'writing' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/use publisherEmail|registered-email/i);
  });

  test('GET /api/tasks 无 Authorization → 200 (list 是公开的)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as unknown[];
    expect(Array.isArray(tasks)).toBe(true);
  });

  test('完整流程: 无 token publish → grab → submit → complete 全用 email', async () => {
    // 1. publish (publisher)
    const pub = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'E2E', description: 'd', reward: 1, type: 'writing',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(pub.status).toBe(201);
    const task = (await pub.json()) as { id: string };

    // 2. grab (agent)
    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });
    expect(grab.status).toBe(200);

    // 3. submit (agent)
    const sub = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL, result: 'work done' }),
    });
    expect(sub.status).toBe(200);

    // 4. complete (publisher)
    const comp = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherEmail: PUB_EMAIL }),
    });
    expect(comp.status).toBe(200);
  });
});