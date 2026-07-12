/**
 * Tests for auth-routes register address field (v0.7)
 *
 * TDD RED — Tests describe expected behavior.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'bun:test';

vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from '../../src/lib/storage/database.js';

describe('AuthRoutes.register — address field (v0.7)', () => {
  let bountyDb: Database;
  let imDb: IMDatabase;
  let server: BountyHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    bountyDb = new Database({ memory: true });
    imDb = new IMDatabase({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => server.stop());

  test('register 接受合法 address 字段', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'alice@example.com',
        name: 'Alice',
        // v0.10 STRICT: must be a valid uuid@host
        address: '8de9b6aa-1111-4000-8000-000000000001@bounty.local',
      }),
    });
    // register 不抛错即成功（注意：实际 address 在 verify 阶段被覆盖）
    expect(res.status).toBe(200);
    const body = (await res.json()) as { agent_id: string; status: string };
    expect(body.agent_id).toBeTruthy();
    expect(body.status).toBe('pending');
  });

  test('register address 格式不合法 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'bob@example.com',
        name: 'Bob',
        address: 'not-a-valid-address-no-at',
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('address');
  });

  test('register 不传 address → 200 (向后兼容)', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'carol@example.com', name: 'Carol' }),
    });
    expect(res.status).toBe(200);
  });

  test('register address 非字符串 → 400', async () => {
    const res = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'dave@example.com',
        name: 'Dave',
        address: 123,
      }),
    });
    expect(res.status).toBe(400);
  });
});