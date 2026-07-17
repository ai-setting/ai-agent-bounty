/**
 * v0.13.2: Tests for IM inbox GET that resolves ?email=<email> to canonical
 * <uuid>@<host> address before ownership check + DB lookup.
 *
 * Background (v0.13.1 bug):
 *   `getMessages(url, requester)` extracted the local part of the supplied
 *   identifier (`alice` from `alice@example.com`) and compared it against
 *   `requester.agentId` (the agent's UUID, e.g. `8de9b6aa-...`). The two
 *   never matched, so every authenticated `?email=` request returned 403.
 *
 *   The IM DB is keyed by canonical address (`<uuid>@<host>`), so even
 *   fixing the ownership check requires resolving the email first.
 *
 * v0.13.2 expected behaviour:
 *   T1: `GET /api/messages?email=<caller-own-email>` w/ own JWT → 200 + messages
 *   T2: `GET /api/messages?email=<other-agent-email>` w/ own JWT → 403
 *   T3: `GET /api/messages?email=<email>` w/o JWT → 401
 *   T4: `GET /api/messages?address=<uuid>@<host>` (legacy) → still 200
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Keep mailer mock to prevent real SMTP during the integration test
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('IM Routes — inbox accepts email (v0.13.2 fix)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let aliceToken: string;
  let bobToken: string;
  let aliceAgentId: string;
  let bobAgentId: string;
  // Use unique emails per test run so re-runs don't hit UNIQUE collisions
  // in the persisted in-memory DB (each beforeEach creates a fresh DB but
  // we want stability for git-blamed behaviour).
  const aliceEmail = `alice.v0132.${Date.now()}@test.local`;
  const bobEmail = `bob.v0132.${Date.now()}@test.local`;

  /**
   * Register → verify → login helper. Mirrors the shape used in
   * im-routes-auth.test.ts so the test reads as integration.
   */
  async function registerVerifyLogin(email: string, _name: string): Promise<{ token: string; agentId: string }> {
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name: email.split('@')[0] }),
    });
    expect(reg.status).toBe(200);

    const verification = bountyDb
      .prepare('SELECT code FROM verifications WHERE email = ?')
      .get(email) as { code: string };
    expect(verification).toBeTruthy();

    const ver = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: verification.code }),
    });
    expect(ver.status).toBe(200);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json() as { token: string; agent_id: string };
    return { token: loginBody.token, agentId: loginBody.agent_id };
  }

  beforeEach(async () => {
    // v0.13: token check ON by default; assert 401/403/200 paths properly.
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;

    const alice = await registerVerifyLogin(aliceEmail, 'Alice');
    const bob = await registerVerifyLogin(bobEmail, 'Bob');
    aliceToken = alice.token;
    aliceAgentId = alice.agentId;
    bobToken = bob.token;
    bobAgentId = bob.agentId;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  // ==== T1: own email → 200 + messages ====
  it('T1: GET /api/messages?email=<own-email> returns 200 with caller inbox', async () => {
    // Resolve alice's canonical address from /api/agents/me. The server
    // resolves register's email to `<uuid>@<BOUNTY_DOMAIN>` (default
    // bounty.local); sending the message to that address is what the IM
    // DB indexes on.
    const meRes = await fetch(`${baseUrl}/api/agents/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(meRes.status).toBe(200);
    const me = (await meRes.json()) as { address: string };
    const aliceCanonicalAddr = me.address;
    expect(aliceCanonicalAddr).toMatch(new RegExp(`^${aliceAgentId}@`));

    // Send a message to alice's canonical address.
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({
        from: `${bobAgentId}@test.com`,
        to: aliceCanonicalAddr,
        content: { type: 'text', body: 'hello alice (v0.13.2)' },
      }),
    });

    const res = await fetch(
      `${baseUrl}/api/messages?email=${encodeURIComponent(aliceEmail)}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    expect(res.status).toBe(200);
    const messages = (await res.json()) as Array<{ to: string; content: { body: string } }>;
    expect(messages.length).toBe(1);
    expect(messages[0]!.content.body).toBe('hello alice (v0.13.2)');
    // The IM DB stores the canonical address; ensure server resolved email → address.
    expect(messages[0]!.to).toBe(aliceCanonicalAddr);
  });

  // ==== T2: another agent's email → 403 ====
  it('T2: GET /api/messages?email=<other-agent-email> returns 403', async () => {
    const res = await fetch(
      `${baseUrl}/api/messages?email=${encodeURIComponent(bobEmail)}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('forbidden');
  });

  // ==== T3: no JWT → 401 ====
  it('T3: GET /api/messages?email=<email> without JWT returns 401', async () => {
    const res = await fetch(
      `${baseUrl}/api/messages?email=${encodeURIComponent(aliceEmail)}`
    );
    expect(res.status).toBe(401);
  });

  // ==== T4: legacy ?address=<uuid>@<host> still works (back-compat) ====
  it('T4: GET /api/messages?address=<uuid>@<host> (legacy) still returns 200', async () => {
    // Resolve alice's canonical address from /api/agents/me.
    const meRes = await fetch(`${baseUrl}/api/agents/me`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const me = (await meRes.json()) as { address: string };
    const aliceCanonicalAddr = me.address;

    // Send a message to alice's canonical address.
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({
        from: `${bobAgentId}@test.com`,
        to: aliceCanonicalAddr,
        content: { type: 'text', body: 'legacy path' },
      }),
    });

    const res = await fetch(
      // Use the canonical address that the DB stores under. The server
      // resolves this via the address column (no email → address lookup).
      `${baseUrl}/api/messages?address=${encodeURIComponent(aliceCanonicalAddr)}`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    expect(res.status).toBe(200);
    const messages = (await res.json()) as Array<{ content: { body: string } }>;
    expect(messages.length).toBe(1);
    expect(messages[0]!.content.body).toBe('legacy path');
  });
});