/**
 * v0.14.1: Tests for IM POST /api/messages — response includes
 * `from_email` and `to_email` (registered emails) alongside the canonical
 * `from` / `to` storage fields.
 *
 * Background (v0.14.0 bug):
 *   CLI `bounty com send` returns `{ from, to }` to the user — both values
 *   are the internal canonical `<uuid>@<host>` form. Users see this and
 *   don't recognise their own or the recipient's email. The server has the
 *   email in `agents.email` already; v0.14.1 surfaces it in the response.
 *
 * v0.14.1 expected behaviour:
 *   T1: Response includes `from_email` (sender's registered email)
 *   T2: Response includes `to_email` (recipient's registered email)
 *   T3: Response still includes canonical `from` / `to` (backward compat)
 *   T4: When `to_email` is unknown, `to_email` falls back to the raw email
 *       (not undefined) — keeps the response shape stable
 *   T5: CLI inbox endpoint also surfaces `from_email` / `to_email` on
 *       returned messages (so the `com inbox` CLI can display emails)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Keep mailer mock to prevent real SMTP during the integration test
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('IM Routes — POST /api/messages response includes from_email / to_email (v0.14.1)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let aliceToken: string;
  let aliceAgentId: string;
  let aliceEmail: string;
  let bobToken: string;
  let bobAgentId: string;
  let bobEmail: string;

  async function registerVerifyLogin(email: string): Promise<{ token: string; agentId: string }> {
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
    const body = (await login.json()) as { token: string; agent_id: string };
    return { token: body.token, agentId: body.agent_id };
  }

  beforeEach(async () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    server.start();
    baseUrl = `http://localhost:${server.getPort()}`;

    const ts = Date.now();
    aliceEmail = `alice.v0141.${ts}@test.local`;
    bobEmail = `bob.v0141.${ts}@test.local`;

    const alice = await registerVerifyLogin(aliceEmail);
    aliceToken = alice.token;
    aliceAgentId = alice.agentId;

    const bob = await registerVerifyLogin(bobEmail);
    bobToken = bob.token;
    bobAgentId = bob.agentId;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  // ==== T1: response includes from_email ====
  it('T1: POST /api/messages response includes from_email (sender registered email)', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: bobEmail,
        content: { type: 'text', body: 'T1 v0.14.1 from-email' },
      }),
    });
    expect(send.status).toBe(201);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.from_email).toBe(aliceEmail);
  });

  // ==== T2: response includes to_email ====
  it('T2: POST /api/messages response includes to_email (recipient registered email)', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: bobEmail,
        content: { type: 'text', body: 'T2 v0.14.1 to-email' },
      }),
    });
    expect(send.status).toBe(201);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.to_email).toBe(bobEmail);
  });

  // ==== T3: response still has canonical from / to (backward compat) ====
  it('T3: POST /api/messages response still includes canonical from / to', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: bobEmail,
        content: { type: 'text', body: 'T3 v0.14.1 canonical' },
      }),
    });
    expect(send.status).toBe(201);
    const body = (await send.json()) as Record<string, unknown>;
    // from is canonical with @authenticated suffix
    expect(body.from).toBe(`${aliceAgentId}@authenticated`);
    // to is canonical <uuid>@<host>
    expect(typeof body.to).toBe('string');
    expect((body.to as string).includes('@')).toBe(true);
    expect(body.to).not.toBe(bobEmail); // canonical, not raw email
  });

  // ==== T4: unknown recipient → to_email falls back to raw email ====
  it('T4: POST /api/messages with unknown to_email → to_email falls back to raw', async () => {
    const unknownEmail = 'ghost.v0141@unregistered.example.com';
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: unknownEmail,
        content: { type: 'text', body: 'T4 v0.14.1 unknown-to' },
      }),
    });
    expect(send.status).toBe(201);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.to_email).toBe(unknownEmail);
    expect(body.to).toBe(unknownEmail); // raw fallback
  });

  // ==== T5: GET /api/messages (inbox) items include from_email / to_email ====
  it('T5: GET /api/messages inbox items include from_email / to_email', async () => {
    // Alice sends to Bob; Bob reads his inbox.
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: bobEmail,
        content: { type: 'text', body: 'T5 v0.14.1 inbox-email' },
      }),
    });

    const inbox = await fetch(`${baseUrl}/api/messages?email=${encodeURIComponent(bobEmail)}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(inbox.status).toBe(200);
    const items = (await inbox.json()) as Array<Record<string, unknown>>;
    expect(items.length).toBe(1);
    expect(items[0]!.from_email).toBe(aliceEmail);
    expect(items[0]!.to_email).toBe(bobEmail);
  });
});