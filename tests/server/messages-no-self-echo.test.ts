/**
 * v0.14.2: Tests for server-side self-echo prevention + recipient validation.
 *
 * Background (v0.14.1 observable bug):
 *   Agents connecting via WebSocket were receiving their own outbound messages
 *   back through the WS push path. Symptom: From/to both gddzhaokun@126.com
 *   appearing as an "inbound" event for an agent that just sent the message.
 *
 * v0.14.2 expected behaviour (server-side root cause fix):
 *   T1: POST /api/messages does not push the outbound message back to the
 *       sender's own WS connection (sender != recipient scenario)
 *   T2: POST /api/messages when `to` resolves to the sender's own UUID
 *       returns HTTP 400 SELF_MESSAGE_NOT_ALLOWED
 *   T3: POST /api/messages when `to_email` does not match any registered
 *       agent returns HTTP 404 RECIPIENT_NOT_FOUND
 *   T4: WS message event path (handleWsMessage case 'message') skips the
 *       push when sender sends to self via WS (defense-in-depth)
 *   T5: v0.14.1 `from_email` / `to_email` enrichment is preserved on the
 *       happy path (sender != recipient)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Keep mailer mock to prevent real SMTP during the integration test
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('v0.14.2: server-side no-self-echo + recipient validation', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;

  async function registerVerifyLogin(email: string): Promise<{ token: string; agentId: string; address: string }> {
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
    const addressRow = bountyDb
      .prepare('SELECT address FROM agents WHERE id = ?')
      .get(body.agent_id) as { address: string };
    return { token: body.token, agentId: body.agent_id, address: addressRow.address };
  }

  beforeEach(async () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    // Wire the push callback so HTTP POST /api/messages goes all the way to
    // the WS push path. Mirrors src/server/server.ts runtime wiring so the
    // tests exercise the real push semantics.
    server.setPushCallback((address, message) => server.pushMessage(address, message));
    server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  // ===== T1: NO self-echo on normal POST =====

  it('T1: POST /api/messages does not push WS event back to sender (sender != recipient)', async () => {
    const sender = await registerVerifyLogin('t1.sender.v0142@test.local');
    // Register recipient to ensure target is known (registration also sets `address`).
    await registerVerifyLogin('t1.recipient.v0142@test.local');

    // Both sender and recipient connect via WS
    const senderWs = new WebSocket(`ws://localhost:${server.getPort()}/ws?email=${encodeURIComponent('t1.sender.v0142@test.local')}`);
    const recipientWs = new WebSocket(`ws://localhost:${server.getPort()}/ws?email=${encodeURIComponent('t1.recipient.v0142@test.local')}`);

    const senderMessages: Array<Record<string, unknown>> = [];
    const recipientMessages: Array<Record<string, unknown>> = [];

    await Promise.all([
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('sender ws connect timeout')), 2000);
        senderWs.onmessage = (e) => {
          const msg = JSON.parse(e.data as string);
          if (msg.event === 'connected') {
            clearTimeout(t);
            resolve();
          } else if (msg.event === 'message') {
            senderMessages.push(msg.data);
          }
        };
      }),
      new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('recipient ws connect timeout')), 2000);
        recipientWs.onmessage = (e) => {
          const msg = JSON.parse(e.data as string);
          if (msg.event === 'connected') {
            clearTimeout(t);
            resolve();
          } else if (msg.event === 'message') {
            recipientMessages.push(msg.data);
          }
        };
      }),
    ]);

    // Sender POSTs the message via HTTP
    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.token}`,
      },
      body: JSON.stringify({
        to_email: 't1.recipient.v0142@test.local',
        content: { type: 'text', body: 'T1 no self echo' },
      }),
    });
    expect(send.status).toBe(201);

    // Wait 300ms for any potential WS push back
    await new Promise((r) => setTimeout(r, 300));

    // Recipient MUST receive the message via WS
    expect(recipientMessages.length).toBeGreaterThanOrEqual(1);
    const pushed = recipientMessages[0] as Record<string, unknown>;
    expect(pushed.content).toEqual({ type: 'text', body: 'T1 no self echo' });
    // v0.14.1 enrichment must still be present
    expect(pushed.fromEmail).toBe('t1.sender.v0142@test.local');
    expect(pushed.toEmail).toBe('t1.recipient.v0142@test.local');

    // Sender MUST NOT receive any 'message' event (self-echo skip)
    expect(senderMessages).toHaveLength(0);

    senderWs.close();
    recipientWs.close();
  });

  // ===== T2: REJECT self-message at HTTP level =====

  it('T2: POST /api/messages with to_email=self → 400 SELF_MESSAGE_NOT_ALLOWED', async () => {
    const sender = await registerVerifyLogin('t2.selfsender.v0142@test.local');

    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.token}`,
      },
      body: JSON.stringify({
        to_email: 't2.selfsender.v0142@test.local', // self!
        content: { type: 'text', body: 'T2 self send should fail' },
      }),
    });

    expect(send.status).toBe(400);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.code).toBe('SELF_MESSAGE_NOT_ALLOWED');
    expect(typeof body.error).toBe('string');

    // Database should NOT have stored a self-message
    const allMessages = imDb.getInbox(sender.address);
    expect(allMessages).toHaveLength(0);
  });

  // ===== T3: REJECT unregistered recipient =====

  it('T3: POST /api/messages with to_email=ghost (not registered) → 404 RECIPIENT_NOT_FOUND', async () => {
    const sender = await registerVerifyLogin('t3.sender.v0142@test.local');

    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.token}`,
      },
      body: JSON.stringify({
        to_email: 'ghost.unregistered.v0142@nowhere.local',
        content: { type: 'text', body: 'T3 unregistered recipient' },
      }),
    });

    expect(send.status).toBe(404);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.code).toBe('RECIPIENT_NOT_FOUND');
    expect(typeof body.error).toBe('string');
  });

  // ===== T4: WS message event self-send is silently skipped =====

  it('T4: WS message event: agent sends to own address via WS → push skipped (defense-in-depth)', async () => {
    const agent = await registerVerifyLogin('t4.selfws.v0142@test.local');

    // Connect via WS with email
    const ws = new WebSocket(`ws://localhost:${server.getPort()}/ws?email=${encodeURIComponent('t4.selfws.v0142@test.local')}`);

    const allReceived: Array<Record<string, unknown>> = [];
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ws connect timeout')), 2000);
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        allReceived.push(msg as Record<string, unknown>);
        if (msg.event === 'connected') {
          clearTimeout(t);
          resolve();
        }
      };
    });

    // Send a WS message event with `to` set to own canonical address
    ws.send(JSON.stringify({
      event: 'message',
      data: {
        to: agent.address,
        content: { type: 'text', body: 'T4 self via WS' },
      },
    }));

    // Wait 300ms for the server to (not) push back
    await new Promise((r) => setTimeout(r, 300));

    // The server may have stored the message (it goes through saveMessage
    // before the push), but the WS client must NOT receive any echo back.
    // Connection 'connected' event is fine, but no 'message' event should
    // follow within this window.
    const messageEventsAfterConnect = allReceived.filter(
      (m) => m.event === 'message'
    );
    expect(messageEventsAfterConnect).toHaveLength(0);

    ws.close();
  });

  // ===== T5: v0.14.1 enrichment preserved after self-echo skip =====

  it('T5: v0.14.1 from_email/to_email enrichment preserved on happy path (sender != recipient)', async () => {
    const sender = await registerVerifyLogin('t5.sender.v0142@test.local');
    const recipient = await registerVerifyLogin('t5.recipient.v0142@test.local');

    const send = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sender.token}`,
      },
      body: JSON.stringify({
        to_email: 't5.recipient.v0142@test.local',
        content: { type: 'text', body: 'T5 enrichment preserved' },
      }),
    });

    // Sanity: 201, enrichment present
    expect(send.status).toBe(201);
    const body = (await send.json()) as Record<string, unknown>;
    expect(body.from_email).toBe('t5.sender.v0142@test.local');
    expect(body.to_email).toBe('t5.recipient.v0142@test.local');
    // Canonical from/to still preserved (backward compat)
    expect(body.from).toBe(`${sender.agentId}@authenticated`);
    expect(body.to).toBe(recipient.address);
  });
});
