/**
 * Tests for v0.14 strict email-only API in BountyRoutes.
 *
 * v0.14 BREAKING (RC-2 fix):
 * - ONLY `body.publisherEmail` / `body.agentEmail` accepted (registered email).
 * - Legacy `body.publisherAddress` / `body.agentAddress` REJECTED with 400
 *   "use publisherEmail" — no silent fallback to address parser.
 * - Bare UUID in any field → 400.
 * - Valid-format but unregistered email → 404.
 * - Internal `agents.address` (uuid@host) is unchanged for IM routing.
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

const PUB_EMAIL = 'pub@example.com';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';
const PUB_FULL = `${PUB_UUID}@bounty.local`;
const AGENT_EMAIL = 'agent@example.com';
const AGENT_UUID = '8de9b6aa-2222-4000-8000-000000000002';
const AGENT_FULL = `${AGENT_UUID}@bounty.local`;

describe('BountyRoutes — v0.14 strict email-only API (RC-2)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
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

  test('createTask accepts publisherEmail (registered email)', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(res.status).toBe(201);
    const task = (await res.json()) as { publisherId: string; publisherEmail: string; status: string };
    expect(task.publisherId).toBe(PUB_UUID);
    expect(task.publisherEmail).toBe(PUB_EMAIL);
    expect(task.status).toBe('open');
  });

  test('v0.14: createTask REJECTS legacy body.publisherAddress — 400', async () => {
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
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/publisherEmail.*your-registered-email/i);
  });

  test('v0.14: createTask returns 404 for valid-format unregistered email', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        type: 'coding',
        publisherEmail: 'ghost@nowhere.example',
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/No registered agent for email/i);
  });

  test('v0.14: createTask returns 400 when no identity field supplied', async () => {
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'T1',
        description: 'D1',
        reward: 10,
        type: 'coding',
      }),
    });
    expect(res.status).toBe(400);
  });

  // ===== grabTask =====

  test('grabTask accepts agentEmail (registered email)', async () => {
    // Create task first
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'GT1',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    expect(pubRes.status).toBe(201);
    const task = (await pubRes.json()) as { id: string };

    const grabRes = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });
    expect(grabRes.status).toBe(200);
    const grabbed = (await grabRes.json()) as { assigneeId: string; status: string };
    expect(grabbed.assigneeId).toBe(AGENT_UUID);
    expect(grabbed.status).toBe('grabbed');
  });

  test('v0.14: grabTask REJECTS legacy body.agentAddress — 400', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'GT2',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    const grabRes = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL }),
    });
    expect(grabRes.status).toBe(400);
  });

  test('v0.14: grabTask returns 404 for valid-format unregistered agentEmail', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'GT3',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    const grabRes = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: 'ghost@nowhere.example' }),
    });
    expect(grabRes.status).toBe(404);
  });

  // ===== submitTask =====

  test('submitTask accepts agentEmail + result', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'ST1',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });

    const subRes = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL, result: 'My work' }),
    });
    expect(subRes.status).toBe(200);
  });

  test('v0.14: submitTask REJECTS legacy body.agentAddress — 400', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'ST2',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    const subRes = await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentAddress: AGENT_FULL, result: 'x' }),
    });
    expect(subRes.status).toBe(400);
  });

  // ===== completeTask =====

  test('completeTask accepts publisherEmail (after task is submitted)', async () => {
    // Publish task
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'CT1',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    // Bob grabs → submits
    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL }),
    });
    await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentEmail: AGENT_EMAIL, result: 'My work' }),
    });

    // Now Alice (publisher) can complete
    const compRes = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherEmail: PUB_EMAIL }),
    });
    expect(compRes.status).toBe(200);
  });

  test('v0.14: completeTask REJECTS legacy body.publisherAddress — 400', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'CT2',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    const compRes = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherAddress: PUB_FULL }),
    });
    expect(compRes.status).toBe(400);
  });

  test('completeTask — non-publisher call returns 403', async () => {
    const pubRes = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'CT3',
        description: 'd',
        reward: 10,
        type: 'coding',
        publisherEmail: PUB_EMAIL,
      }),
    });
    const task = (await pubRes.json()) as { id: string };

    // AgentBob (different agent) tries to complete Alice's task → 403
    const compRes = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ publisherEmail: AGENT_EMAIL }),
    });
    expect(compRes.status).toBe(403);
  });
});