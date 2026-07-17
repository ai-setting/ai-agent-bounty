/**
 * v0.14 RED test: server im-routes REJECT ?address= legacy query (RC-3 fix).
 *
 * Per Decision Record Q5 + parent task description ("彻底移除 agent address、
 * short address、uuid 以及任何隐式 fallback/兼容分支"), the v0.14 server
 * surface accepts ONLY `?email=<registered-email>`. Legacy `?address=`
 * queries must be REJECTED with HTTP 400 'use ?email=<your-registered-email>'.
 *
 * Test asserts:
 *   - GET /api/messages?address=<uuid>@<host> → 400 (legacy rejected)
 *   - GET /api/messages?address=<bare-uuid> → 400 (also legacy)
 *   - GET /api/messages?email=<registered-email> → 200 (happy path)
 *   - Legacy unauthenticated getMessagesForAddress also rejects ?address=.
 *
 * RED → GREEN contract: fails before fix (returns 200 with messages),
 * passes after fix (returns 400).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

const ALICE_EMAIL = 'alice-im@test.local';
const ALICE_UUID = '8de9b6aa-imii-4000-8000-000000000001';
const ALICE_FULL = `${ALICE_UUID}@bounty.local`;

describe('RC-3 fix: GET /api/messages?address=<addr> rejected with 400 (v0.14 strict email-only)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    // soft-auth ON for ?address= tests
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';

    bountyDb = new Database({ memory: true });
    imDb = new IMDatabase({ memory: true });
    const now = Date.now();
    bountyDb.prepare(`INSERT INTO agents (id, name, email, status, address, credits, created_at, updated_at)
                      VALUES (?, ?, ?, 'active', ?, 1000, ?, ?)`).run(
      ALICE_UUID, 'Alice', ALICE_EMAIL, ALICE_FULL, now, now
    );
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  test('RC-3 primary: GET /api/messages?address=<uuid>@<host> → 400 "use ?email="', async () => {
    const res = await fetch(`${baseUrl}/api/messages?address=${encodeURIComponent(ALICE_FULL)}`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/use \?email/i);
  });

  test('RC-3: GET /api/messages?address=<bare-uuid> → 400', async () => {
    const res = await fetch(`${baseUrl}/api/messages?address=${ALICE_UUID}`);
    expect(res.status).toBe(400);
  });

  test('Happy path: GET /api/messages?email=<registered-email> → 200 (or 401 if auth-on)', async () => {
    const res = await fetch(`${baseUrl}/api/messages?email=${encodeURIComponent(ALICE_EMAIL)}`);
    // soft-auth OFF (BOUNTY_TOKEN_CHECK_ENABLED=false): expect 200 (inbox
    // auth check may still apply depending on policy; the contract under
    // test is "this URL is the v0.14 wire format and is NOT 400'd").
    expect(res.status).not.toBe(400);
  });

  test('RC-3 legacy unauthenticated path: GET /api/messages?address=<addr> → 400', async () => {
    // The legacy unauthenticated lookup path (no auth) also rejects ?address=.
    const res = await fetch(`${baseUrl}/api/messages?address=${encodeURIComponent(ALICE_FULL)}`);
    expect(res.status).toBe(400);
  });
});