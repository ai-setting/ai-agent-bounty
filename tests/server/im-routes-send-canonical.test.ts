/**
 * v0.13.4: Tests for IM sendMessage() — `to_address` must be stored as the
 * canonical `<uuid>@<host>` form, not the raw email string.
 *
 * Background (v0.13.0–v0.13.3 bug):
 *   `POST /api/messages` with `to_email="alice@example.com"` persisted
 *   `im_messages.to_address = "alice@example.com"` (raw email).
 *   Meanwhile `GET /api/messages?email=...` (v0.13.2) resolves the email
 *   to canonical `<uuid>@<host>` BEFORE the IM DB lookup, so the two keys
 *   never matched and the inbox always returned `[]` for the just-sent
 *   message.
 *
 * v0.13.4 expected behaviour:
 *   T1: POST with `to_email=<registered-email>` → IM DB row stores canonical
 *   T2: POST with `to=<uuid>@<host>` (legacy) → IM DB row stores the input as-is
 *   T3: POST with `to_email=<unknown-email>` → 404 RECIPIENT_NOT_FOUND
 *       (v0.14.2 supersedes the v0.13.4 raw-fallback behaviour; unknown
 *       recipients are surfaced as a clear error instead of silently
 *       dropping into a phantom inbox).
 *   T4: Agent sends to self via `to_email` → 400 SELF_MESSAGE_NOT_ALLOWED
 *       (v0.14.2 supersedes the v0.13.4 self-send path; self-message is
 *       explicitly rejected to avoid the WS self-echo loop observed in
 *       v0.14.1).
 *   T5: Regression — `from_address` is still `${agentId}@authenticated`,
 *       untouched by the new canonicalization logic.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Keep mailer mock to prevent real SMTP during the integration test
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('IM Routes — sendMessage stores canonical address (v0.13.4 fix)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let aliceToken: string;
  let aliceAgentId: string;
  let aliceAddress: string;
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
    // token check ON so we exercise the authenticated path
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    server.start();
    baseUrl = `http://localhost:${server.getPort()}`;

    // Use unique emails per run to dodge any persisted-DB collisions.
    const ts = Date.now();
    aliceEmail = `alice.v0134.${ts}@test.local`;
    bobEmail   = `bob.v0134.${ts}@test.local`;

    const alice = await registerVerifyLogin(aliceEmail);
    aliceToken = alice.token;
    aliceAgentId = alice.agentId;

    const bob = await registerVerifyLogin(bobEmail);
    bobToken = bob.token;
    bobAgentId = bob.agentId;

    // Resolve alice's canonical address from the agents table.
    const aliceRow = bountyDb
      .prepare('SELECT address FROM agents WHERE id = ?')
      .get(aliceAgentId) as { address: string };
    aliceAddress = aliceRow.address;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  // ==== T1: to_email is resolved to canonical <uuid>@<host> before persist ====
  it('T1: POST /api/messages with to_email=<email> persists canonical address', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        to_email: aliceEmail,
        content: { type: 'text', body: 'T1 v0.13.4 send-by-email' },
      }),
    });
    expect(send.status).toBe(201);

    // Verify the IM DB row's to_address is canonical, not the raw email.
    // getInbox(rawEmail) returns 0; getInbox(canonical) returns the message.
    expect(imDb.getInbox(aliceEmail).length).toBe(0);
    const inbox = imDb.getInbox(aliceAddress);
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.to).toBe(aliceAddress);
    expect(inbox[0]!.content.body).toBe('T1 v0.13.4 send-by-email');
  });

  // ==== T2: legacy `to=<uuid>@<host>` is unchanged ====
  it('T2: POST /api/messages with to=<uuid>@<host> stores input as-is', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        to: aliceAddress,
        content: { type: 'text', body: 'T2 v0.13.4 legacy-to' },
      }),
    });
    expect(send.status).toBe(201);

    const inbox = imDb.getInbox(aliceAddress);
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.to).toBe(aliceAddress);
  });

  // ==== T3: unknown email → 404 RECIPIENT_NOT_FOUND (v0.14.2 contract) ====
  it('T3: POST /api/messages with to_email=<unknown> returns 404', async () => {
    const unknownEmail = 'ghost.v0134@unregistered.example.com';

    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        to_email: unknownEmail,
        content: { type: 'text', body: 'T3 v0.14.2 unknown-recipient' },
      }),
    });
    // v0.14.2 supersedes the v0.13.4 raw-fallback behaviour: unregistered
    // recipients are now surfaced as HTTP 404 RECIPIENT_NOT_FOUND instead
    // of being silently dropped into a phantom inbox keyed by the raw email.
    expect(send.status).toBe(404);
    const body = (await send.json()) as { code?: string; error?: string };
    expect(body.code).toBe('RECIPIENT_NOT_FOUND');

    // The IM DB must NOT have stored a phantom message for the unknown recipient.
    expect(imDb.getInbox(unknownEmail).length).toBe(0);
  });

  // ==== T4: self-message → 400 SELF_MESSAGE_NOT_ALLOWED (v0.14.2 contract) ====
  it('T4: agent sends to self via to_email → 400 SELF_MESSAGE_NOT_ALLOWED', async () => {
    // Alice tries to send to herself (by email). v0.14.2 closes this path
    // because it would otherwise push the message back to the sender's own
    // WS connection (the observable v0.14.1 self-echo bug).
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        to_email: aliceEmail,
        content: { type: 'text', body: 'T4 self-send v0.14.2' },
      }),
    });
    expect(send.status).toBe(400);
    const body = (await send.json()) as { code?: string; error?: string };
    expect(body.code).toBe('SELF_MESSAGE_NOT_ALLOWED');

    // No self-message is stored.
    expect(imDb.getInbox(aliceAddress).length).toBe(0);
  });

  // ==== T5: from_address regression — still ${agentId}@authenticated ====
  it('T5: from_address is still agentId@authenticated, untouched by canonicalization', async () => {
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        to_email: aliceEmail,
        // body.from* should be IGNORED when authenticated; the server
        // overwrites with `${requester.agentId}@authenticated`.
        from: 'impostor@evil.example.com',
        content: { type: 'text', body: 'T5 from regression' },
      }),
    });
    expect(send.status).toBe(201);

    const inbox = imDb.getInbox(aliceAddress);
    expect(inbox.length).toBe(1);
    expect(inbox[0]!.from).toBe(`${bobAgentId}@authenticated`);
    expect(inbox[0]!.from).not.toBe('impostor@evil.example.com');
  });
});