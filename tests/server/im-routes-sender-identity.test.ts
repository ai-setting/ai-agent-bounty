/**
 * IM Routes sender-identity regression suite (Phase 4 hardener)
 *
 * Validates the from-sourcing contract end-to-end at the HTTP layer:
 *
 * 1. No Authorization header + tokenCheckEnabled=false
 *    → from = body.from (legacy path; sender is caller-controlled)
 *
 * 2. No Authorization header + tokenCheckEnabled=true
 *    → 401 Unauthorized (auth gate fires before route dispatch)
 *
 * 3. Valid Authorization header (tokenCheckEnabled=true)
 *    → from = `${agentId}@authenticated` (server asserts identity)
 *
 * 4. **Contract-lock** (forces RED before fix):
 *    No Authorization + tokenCheckEnabled=false → `imRoutes.sendMessage`
 *    MUST be called WITHOUT a `requester` argument. Passing
 *    `{ agentId: undefined }` is semantically wrong: it implies
 *    "authenticated agent with no id" rather than "no requester at all".
 *    The downstream ternary still produces the correct `from` today, but
 *    the call site is fragile and conflicts with the spirit of commit
 *    4ed7b27 (which preserved the from-sourcing legacy path).
 *
 * These tests guard against silent regressions if a future refactor
 * changes the im-routes ternary, drops the undefined check, or tightens
 * the agentId! pattern at the call site.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';

// Mock mailer to prevent real SMTP during integration tests
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('IM Routes sender identity (HTTP-level regression)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  afterEach(() => {
    server?.stop();
    imDb?.close();
    bountyDb?.close();
    if (originalEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalEnv;
    }
  });

  async function setupServer(tokenCheck: boolean) {
    if (tokenCheck) {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    } else {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    }
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  }

  async function registerVerifyLogin(
    email: string,
    name: string
  ): Promise<{ token: string; agentId: string }> {
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    expect(reg.status).toBe(200);
    await reg.json(); // discard — login echoes agent_id

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
    const loginBody = (await login.json()) as { token: string; agent_id: string };
    return { token: loginBody.token, agentId: loginBody.agent_id };
  }

  test('1. No Auth + tokenCheckOff → from = body.from (legacy path)', async () => {
    await setupServer(false);

    const body = {
      from: 'caller@legacy.example.com',
      to: 'recipient@legacy.example.com',
      content: { type: 'text', body: 'hello' },
    };

    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    expect(res.status).toBe(201);
    const msg = (await res.json()) as { from: string; to: string };
    expect(msg.from).toBe(body.from);
    expect(msg.from).not.toContain('@authenticated');
  });

  test('2. No Auth + tokenCheckOn → 401 Unauthorized', async () => {
    await setupServer(true);

    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'caller@example.com',
        to: 'recipient@example.com',
        content: { type: 'text', body: 'sneaky' },
      }),
    });

    expect(res.status).toBe(401);
  });

  test('3. Valid Auth (tokenCheckOn) → from = `${agentId}@authenticated`', async () => {
    await setupServer(true);

    const { token, agentId } = await registerVerifyLogin('alice@test.com', 'Alice');

    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        from: 'should-be-overridden@test.com',
        to: 'bob@recipient.test.com',
        content: { type: 'text', body: 'real alice here' },
      }),
    });

    expect(res.status).toBe(201);
    const msg = (await res.json()) as { from: string; to: string };
    expect(msg.from).toBe(`${agentId}@authenticated`);
  });

  test('4. Contract-lock: tokenCheckOff calls sendMessage WITHOUT requester arg', async () => {
    await setupServer(false);

    // Spy on imRoutes.sendMessage to capture the actual requester argument
    // passed by the HTTP server. The fix must call sendMessage with
    // requester === undefined (NOT { agentId: undefined }) when token
    // check is off and no Authorization header is present.
    const imRoutes = (server as any).imRoutes;
    expect(imRoutes).toBeTruthy();

    const calls: Array<{ args: unknown[] }> = [];
    const originalSendMessage = imRoutes.sendMessage.bind(imRoutes);
    imRoutes.sendMessage = async function (req: Request, requester?: unknown) {
      calls.push({ args: [req, requester] });
      return originalSendMessage(req, requester);
    };

    const res = await fetch(`${baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'caller@contract.test',
        to: 'recipient@contract.test',
        content: { type: 'text', body: 'contract lock' },
      }),
    });

    expect(res.status).toBe(201);
    expect(calls.length).toBe(1);

    // The fix: requester must be undefined (or omitted), never
    // `{ agentId: undefined }`. The downstream ternary falls back to
    // body.from via the legacy path either way today, but the call
    // contract is wrong as-is.
    const passedRequester = calls[0]!.args[1];
    expect(passedRequester).toBeUndefined();

    // Belt-and-suspenders: even if someone adds an "or default to {}"
    // in the future, reject the explicit-undefined-agentId shape.
    if (passedRequester && typeof passedRequester === 'object') {
      expect((passedRequester as { agentId?: unknown }).agentId).toBeTruthy();
    }
  });
});