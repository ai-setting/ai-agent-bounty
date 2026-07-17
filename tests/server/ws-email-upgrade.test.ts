/**
 * v0.13: WebSocket upgrade accepts `?email=<addr>` and resolves it to the
 * canonical `<uuid>@<host>` address. Legacy `?address=<addr>` continues
 * to work.
 *
 * We exercise the upgrade handler indirectly by hitting the HTTP `/ws`
 * path and checking the 400/401 surface — successful upgrade cannot be
 * observed via plain fetch (no WS handshake).
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
    'Alice',
    'alice@example.com',
    '8de9b6aa-1111-4000-8000-000000000001@bounty.local',
    now,
    now
  );
  return db;
}

describe('WebSocket upgrade — email-first (v0.13)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    bountyDb = makeBountyDb();
    imDb = new IMDatabase({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
  });

  test('?email=alice@example.com 被接受（v0.13 primary）', async () => {
    // Trigger the upgrade path. Bun.serve.upgrade() will succeed and return
    // an empty 200/101 response. We only care that we don't get 400.
    const res = await fetch(`${baseUrl}/ws?email=alice@example.com`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        // Required WebSocket handshake headers
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    // Either 101 (upgrade) or 200 (Bun already-upgraded response). Anything
    // other than 400 (missing param) is acceptable for our purposes.
    expect(res.status).not.toBe(400);
  });

  test('?address=<uuid>@<host> 仍可用（legacy 兼容）', async () => {
    const addr = '8de9b6aa-1111-4000-8000-000000000001@bounty.local';
    const res = await fetch(`${baseUrl}/ws?address=${encodeURIComponent(addr)}`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    expect(res.status).not.toBe(400);
  });

  test('既无 email 也无 address → 400', async () => {
    const res = await fetch(`${baseUrl}/ws`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { event: string; data: { message: string } };
    expect(body.event).toBe('error');
    expect(body.data.message.toLowerCase()).toContain('email');
  });

  test('?email= 不存在的邮箱 → 400（无法 resolve 到 address）', async () => {
    const res = await fetch(`${baseUrl}/ws?email=ghost@example.com`, {
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { event: string; data: { message: string } };
    expect(body.data.message.toLowerCase()).toContain('email');
  });
});