/**
 * v0.14 RED test: board --publisher-email filter end-to-end (FB-1 fix).
 *
 * The CLI sends `?publisherId=<email>` on the wire (verified by
 * tests/cli/bounty-task-board-publisher-email.test.ts:119). The server
 * must resolve that email → agent.id BEFORE running the WHERE
 * publisher_id = ? clause, otherwise no rows match and the user sees
 * an empty list (functional bug — silent mis-route).
 *
 * Test asserts:
 *   - Publish 2 tasks as alice@example.com and 1 task as bob@example.com
 *   - GET /api/tasks?publisherId=alice@example.com → 2 tasks (not 0, not 3)
 *   - GET /api/tasks?publisherId=<alice-uuid> → 2 tasks (legacy UUID path)
 *   - GET /api/tasks?publisherId=bob@example.com → 1 task
 *   - GET /api/tasks?publisherId=ghost@nowhere.com → 0 tasks (404 / empty)
 *
 * RED → GREEN contract: this test should FAIL before the server fix
 * (returns 0 for the email lookup) and PASS after the server resolves
 * email → agent.id before the WHERE clause.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { createBountyTestServer, type BountyTestServerHandle } from '../../src/cli/lib/bounty-test-server.js';

const ALICE_EMAIL = 'alice-pub@test.local';
const ALICE_UUID = '8de9b6aa-aaaa-4000-8000-000000000001';
const BOB_EMAIL = 'bob-pub@test.local';
const BOB_UUID = '8de9b6aa-bbbb-4000-8000-000000000002';

describe('FB-1 fix: GET /api/tasks?publisherId=<email> resolves email → agent.id (v0.14)', () => {
  let server: BountyTestServerHandle;
  let aliceTaskId: string;
  let bobTaskId: string;

  beforeAll(async () => {
    server = await createBountyTestServer({
      port: 0,
      seedAgents: [
        { id: ALICE_UUID, email: ALICE_EMAIL, name: 'Alice', credits: 1000 },
        { id: BOB_UUID, email: BOB_EMAIL, name: 'Bob', credits: 1000 },
      ],
    });

    // Publish 2 tasks as Alice
    for (let i = 0; i < 2; i++) {
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Id': ALICE_UUID },
        body: JSON.stringify({
          title: `alice task ${i}`,
          description: 'd',
          reward: 100 + i,
          type: 'coding',
          publisherEmail: ALICE_EMAIL,
        }),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { id: string };
      if (i === 0) aliceTaskId = body.id;
    }

    // Publish 1 task as Bob
    {
      const res = await fetch(`${server.baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Agent-Id': BOB_UUID },
        body: JSON.stringify({
          title: 'bob task',
          description: 'd',
          reward: 50,
          type: 'coding',
          publisherEmail: BOB_EMAIL,
        }),
      });
      expect(res.status).toBe(201);
      bobTaskId = (await res.json() as { id: string }).id;
    }
  });

  afterAll(async () => {
    if (server) await server.stop();
  });

  test('email-shape ?publisherId resolves to agent.id (FB-1 primary fix)', async () => {
    const res = await fetch(`${server.baseUrl}/api/tasks?publisherId=${encodeURIComponent(ALICE_EMAIL)}`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as Array<{ id: string; publisherEmail?: string }>;
    expect(tasks.length).toBe(2);
    for (const t of tasks) {
      expect(t.publisherEmail).toBe(ALICE_EMAIL);
    }
  });

  test('legacy UUID-shape ?publisherId still works (backward-compat with v0.13 internal storage)', async () => {
    const res = await fetch(`${server.baseUrl}/api/tasks?publisherId=${ALICE_UUID}`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as Array<{ id: string }>;
    expect(tasks.length).toBe(2);
  });

  test('email-shape ?publisherId=bob@example.com returns exactly 1 task', async () => {
    const res = await fetch(`${server.baseUrl}/api/tasks?publisherId=${encodeURIComponent(BOB_EMAIL)}`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as Array<{ id: string; publisherEmail?: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0]?.id).toBe(bobTaskId);
  });

  test('valid-format unregistered email returns empty list (not 404 — list() does not 404)', async () => {
    const res = await fetch(`${server.baseUrl}/api/tasks?publisherId=${encodeURIComponent('ghost@nowhere.example')}`);
    expect(res.status).toBe(200);
    const tasks = (await res.json()) as unknown[];
    expect(tasks).toEqual([]);
  });
});