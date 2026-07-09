/**
 * Tests for BOUNTY_TOKEN_CHECK_ENABLED env var toggle (Phase 4)
 *
 * 关键行为:
 * - 默认: token check 关闭（任何 caller 不需要 auth header）
 * - 设 env=true/1: token check 开启（Bearer token 必须有）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import type { IMDatabase } from '../../src/im/db/index.js';

function makeImDb(): IMDatabase {
  return new Database(':memory:') as any;
}

describe('BOUNTY_TOKEN_CHECK_ENABLED toggle', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalEnv;
    }
  });

  test('默认 (env 未设): token check 关闭', () => {
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    const bountyDb = new Database(':memory:');
    const imDb = makeImDb();
    const srv = new BountyHTTPServer({
      imDb: imDb as any,
      bountyDb: bountyDb as any,
      port: 0,  // any free port
    });
    
    expect((srv as any).tokenCheckEnabled).toBe(false);
  });

  test('BOUNTY_TOKEN_CHECK_ENABLED=true 开启 token check', () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    const bountyDb = new Database(':memory:');
    const imDb = makeImDb();
    const srv = new BountyHTTPServer({
      imDb: imDb as any,
      bountyDb: bountyDb as any,
      port: 0,
    });
    
    expect((srv as any).tokenCheckEnabled).toBe(true);
  });

  test('BOUNTY_TOKEN_CHECK_ENABLED=1 (数字) 也开启', () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = '1';
    const srv = new BountyHTTPServer({
      imDb: makeImDb() as any,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    
    expect((srv as any).tokenCheckEnabled).toBe(true);
  });

  test('BOUNTY_TOKEN_CHECK_ENABLED=false 显式关闭', () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';
    const srv = new BountyHTTPServer({
      imDb: makeImDb() as any,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    
    expect((srv as any).tokenCheckEnabled).toBe(false);
  });

  test('未识别值 (例如 "yes") 默认禁用', () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'yes';
    const srv = new BountyHTTPServer({
      imDb: makeImDb() as any,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    
    expect((srv as any).tokenCheckEnabled).toBe(false);
  });
});

describe('checkAuth behavior under token check toggle', () => {
  let server: BountyHTTPServer;
  let imDb: IMDatabase;

  beforeEach(() => {
    imDb = new Database(':memory:') as any;
  });

  test('token check 关闭: 不带 Authorization 头也能过 checkAuth', async () => {
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    server = new BountyHTTPServer({
      imDb,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      body: '{}',
    });
    // no Authorization header

    const result = await (server as any).checkAuth(req);
    expect(result.error).toBeUndefined();
    expect(result.agentId).toBeUndefined(); // bypass, no agentId extracted
  });

  test('token check 关闭: 即使带坏 header 也能过 (bypass)', async () => {
    delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    server = new BountyHTTPServer({
      imDb,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer bad-token-format' },
      body: '{}',
    });

    const result = await (server as any).checkAuth(req);
    expect(result.error).toBeUndefined();
  });

  test('token check 开启: 没 header → 401', async () => {
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'true';
    server = new BountyHTTPServer({
      imDb,
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      body: '{}',
    });

    const result = await (server as any).checkAuth(req);
    expect(result.error).toBeDefined();
    expect(result.error.status).toBe(401);
  });
});
