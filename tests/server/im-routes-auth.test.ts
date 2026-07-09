/**
 * IM Routes must require auth and address ownership (H2)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// Keep mailer mock to prevent real SMTP during the integration test
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('IM Routes Auth (H2)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let aliceToken: string;
  let bobToken: string;
  let aliceAgentId: string;
  let bobAgentId: string;

  async function registerVerifyLogin(email: string, name: string): Promise<{ token: string; agentId: string }> {
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    expect(reg.status).toBe(200);
    const regBody = (await reg.json()) as { agent_id: string };

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
    // 此 test 期望 token check ON 行为（baseline 401/403）
    // 显式设 BOUNTY_TOKEN_CHECK_ENABLED=true
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = "true";
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;

    const alice = await registerVerifyLogin('alice@test.com', 'Alice');
    const bob = await registerVerifyLogin('bob@test.com', 'Bob');
    aliceToken = alice.token;
    aliceAgentId = alice.agentId;
    bobToken = bob.token;
    bobAgentId = bob.agentId;
  });

  afterEach(() => {
    server.stop();
  });

  it('GET /api/messages requires Bearer token', async () => {
    const res = await fetch(`${baseUrl}/api/messages?address=${aliceAgentId}@test.com`);
    expect(res.status).toBe(401);
  });

  it('GET /api/messages returns 403 when address query does not match requester', async () => {
    const res = await fetch(
      `${baseUrl}/api/messages?address=${bobAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    expect(res.status).toBe(403);
  });

  it('GET /api/messages returns only the requester own inbox', async () => {
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        from: `${aliceAgentId}@test.com`,
        to: `${bobAgentId}@test.com`,
        content: { type: 'text', body: 'hello bob' },
      }),
    });

    const aliceInbox = await fetch(
      `${baseUrl}/api/messages?address=${aliceAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${aliceToken}` } }
    );
    expect(aliceInbox.status).toBe(200);
    expect((await aliceInbox.json() as unknown[]).length).toBe(0);

    const bobInbox = await fetch(
      `${baseUrl}/api/messages?address=${bobAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    expect(bobInbox.status).toBe(200);
    const bobMessages = await bobInbox.json() as Array<{ to: string; content: { body: string } }>;
    expect(bobMessages.length).toBe(1);
    expect(bobMessages[0]!.content.body).toBe('hello bob');
  });

  it('GET /api/messages/:id requires Bearer token', async () => {
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        from: `${aliceAgentId}@test.com`,
        to: `${bobAgentId}@test.com`,
        content: { type: 'text', body: 'secret' },
      }),
    });

    const bobInbox = await fetch(
      `${baseUrl}/api/messages?address=${bobAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const bobMessages = await bobInbox.json() as Array<{ id: string }>;
    expect(bobMessages.length).toBe(1);
    const id = bobMessages[0]!.id;

    const noTokenRes = await fetch(`${baseUrl}/api/messages/${id}`);
    expect(noTokenRes.status).toBe(401);
  });

  it('GET /api/messages/:id returns 403 for non-participants', async () => {
    const mal = await registerVerifyLogin('mallory@test.com', 'Mallory');

    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        from: `${aliceAgentId}@test.com`,
        to: `${bobAgentId}@test.com`,
        content: { type: 'text', body: 'private' },
      }),
    });
    const bobInbox = await fetch(
      `${baseUrl}/api/messages?address=${bobAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const bobMessages = await bobInbox.json() as Array<{ id: string }>;
    const id = bobMessages[0]!.id;

    const malloryRes = await fetch(`${baseUrl}/api/messages/${id}`, {
      headers: { Authorization: `Bearer ${mal.token}` },
    });
    expect(malloryRes.status).toBe(403);
  });

  it('GET /api/messages/:id allows sender and recipient', async () => {
    await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${aliceToken}` },
      body: JSON.stringify({
        from: `${aliceAgentId}@test.com`,
        to: `${bobAgentId}@test.com`,
        content: { type: 'text', body: 'shared' },
      }),
    });
    const bobInbox = await fetch(
      `${baseUrl}/api/messages?address=${bobAgentId}@test.com`,
      { headers: { Authorization: `Bearer ${bobToken}` } }
    );
    const bobMessages = await bobInbox.json() as Array<{ id: string }>;
    const id = bobMessages[0]!.id;

    const aliceRes = await fetch(`${baseUrl}/api/messages/${id}`, {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    expect(aliceRes.status).toBe(200);

    const bobRes = await fetch(`${baseUrl}/api/messages/${id}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobRes.status).toBe(200);
  });
});
