/**
 * v0.13: Tests for IM routes email-first API.
 *
 * v0.13 changes:
 *   - `POST /api/messages` accepts `from_email`/`to_email` body fields.
 *     Legacy `from`/`to` (address strings) still accepted.
 *   - `GET /api/messages?email=<addr>` accepted as primary. Legacy
 *     `?address=<addr>` still works for callers that have not migrated.
 *   - WebSocket handler accepts `?email=<addr>` (resolved to address by server).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';
import { normalizeAgentIdentifier } from '../../src/server/http/im-routes.js';

function makeBountyDb(): Database {
  const db = new Database({ memory: true });
  const now = Date.now();
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-1111-4000-8000-000000000001',
    'Alice',
    'alice@example.com',
    '8de9b6aa-1111-4000-8000-000000000001@bounty.local',
    now,
    now
  );
  db.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
              VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
    '8de9b6aa-2222-4000-8000-000000000002',
    'Bob',
    'bob@example.com',
    '8de9b6aa-2222-4000-8000-000000000002@bounty.local',
    now,
    now
  );
  return db;
}

const ALICE_ADDR = '8de9b6aa-1111-4000-8000-000000000001@bounty.local';
const ALICE_EMAIL = 'alice@example.com';
const BOB_ADDR = '8de9b6aa-2222-4000-8000-000000000002@bounty.local';
const BOB_EMAIL = 'bob@example.com';

describe('normalizeAgentIdentifier (v0.13 helper)', () => {
  test('字符串 → trim 后原样返回', () => {
    expect(normalizeAgentIdentifier('  alice@example.com  ')).toBe('alice@example.com');
  });
  test('空字符串 → null', () => {
    expect(normalizeAgentIdentifier('')).toBeNull();
  });
  test('纯空白 → null', () => {
    expect(normalizeAgentIdentifier('   ')).toBeNull();
  });
  test('非字符串 → null', () => {
    expect(normalizeAgentIdentifier(null)).toBeNull();
    expect(normalizeAgentIdentifier(undefined)).toBeNull();
    expect(normalizeAgentIdentifier(123)).toBeNull();
    expect(normalizeAgentIdentifier({})).toBeNull();
  });
});

describe('IM routes — email-first API (v0.13)', () => {
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

  // ===== POST /api/messages =====

  test('sendMessage 接受 to_email（v0.13 primary）', async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to_email: BOB_EMAIL,
        content: { type: 'text', body: 'hello via email' },
      }),
    });
    expect(res.status).toBe(201);
    const msg = (await res.json()) as { to: string };
    expect(msg.to).toBe(BOB_EMAIL);
  });

  test('sendMessage to (legacy address) 仍可用', async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: BOB_ADDR,
        content: { type: 'text', body: 'hello via address' },
      }),
    });
    expect(res.status).toBe(201);
    const msg = (await res.json()) as { to: string };
    expect(msg.to).toBe(BOB_ADDR);
  });

  test('sendMessage 缺 to_email/to → 400', async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { type: 'text', body: 'orphan' },
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('to_email');
  });

  test('sendMessage 同时给 from_email (token check off) → from 来自 body', async () => {
    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_email: ALICE_EMAIL,
        to_email: BOB_EMAIL,
        content: { type: 'text', body: 'authenticated email' },
      }),
    });
    expect(res.status).toBe(201);
    const msg = (await res.json()) as { from: string };
    expect(msg.from).toBe(ALICE_EMAIL);
  });
});