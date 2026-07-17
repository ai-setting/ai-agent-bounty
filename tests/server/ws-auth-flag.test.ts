/**
 * Tests for `BOUNTY_WS_AUTH_REQUIRED` feature flag (PR4).
 *
 * Contract:
 * - 默认 (env 未设): wsAuthRequired = false → WS upgrade 接受任意 caller (向后兼容)
 * - 设 env=true/1: wsAuthRequired = true → WS upgrade 必须有 Authorization: Bearer <valid-jwt>
 *   - 缺 header → 401
 *   - 坏 token → 401
 *   - 好 token → upgrade 成功
 * - 设 env=false/0: 显式关闭 (等同默认)
 *
 * 注: 这些测试用 HTTP 层验证 (/ws 走 upgrade path 在 handleRequest 内 dispatch),
 * 不真正开 WebSocket 连接 — 避免拉起 Bun.serve WS client 依赖。
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { BountyHTTPServer } from '../../src/server/http/index.js';
import { IMDatabase } from '../../src/im/db/index.js';
import { Database } from 'bun:sqlite';

function makeImDb(): IMDatabase {
  return new Database(':memory:') as any;
}

describe('BOUNTY_WS_AUTH_REQUIRED feature flag', () => {
  let originalWsFlag: string | undefined;

  beforeEach(() => {
    originalWsFlag = process.env.BOUNTY_WS_AUTH_REQUIRED;
    delete process.env.BOUNTY_WS_AUTH_REQUIRED;
  });

  afterEach(() => {
    if (originalWsFlag === undefined) {
      delete process.env.BOUNTY_WS_AUTH_REQUIRED;
    } else {
      process.env.BOUNTY_WS_AUTH_REQUIRED = originalWsFlag;
    }
  });

  test('默认 (env 未设): wsAuthRequired = false', () => {
    delete process.env.BOUNTY_WS_AUTH_REQUIRED;
    const srv = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    expect((srv as any).wsAuthRequired).toBe(false);
  });

  test('BOUNTY_WS_AUTH_REQUIRED=true 开启 WS auth', () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = 'true';
    const srv = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    expect((srv as any).wsAuthRequired).toBe(true);
  });

  test('BOUNTY_WS_AUTH_REQUIRED=1 (数字) 也开启', () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = '1';
    const srv = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    expect((srv as any).wsAuthRequired).toBe(true);
  });

  test('BOUNTY_WS_AUTH_REQUIRED=false 显式关闭', () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = 'false';
    const srv = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    expect((srv as any).wsAuthRequired).toBe(false);
  });

  test('未识别值 默认关闭 (保守)', () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = 'yes';
    const srv = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
    expect((srv as any).wsAuthRequired).toBe(false);
  });
});

describe('WS upgrade behavior under BOUNTY_WS_AUTH_REQUIRED', () => {
  let originalTokenEnv: string | undefined;
  let originalWsFlag: string | undefined;
  let server: BountyHTTPServer;

  beforeEach(async () => {
    originalTokenEnv = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    originalWsFlag = process.env.BOUNTY_WS_AUTH_REQUIRED;
    // ws upgrade 走 handleRequest 的 WS branch，与 tokenCheckEnabled 独立。
    // 这些测试显式 token check off，让失败原因只能是 WS auth。
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = 'false';
  });

  afterEach(() => {
    server?.stop();
    if (originalTokenEnv === undefined) {
      delete process.env.BOUNTY_TOKEN_CHECK_ENABLED;
    } else {
      process.env.BOUNTY_TOKEN_CHECK_ENABLED = originalTokenEnv;
    }
    if (originalWsFlag === undefined) {
      delete process.env.BOUNTY_WS_AUTH_REQUIRED;
    } else {
      process.env.BOUNTY_WS_AUTH_REQUIRED = originalWsFlag;
    }
  });

  function buildServer(): void {
    server = new BountyHTTPServer({
      imDb: makeImDb(),
      bountyDb: new Database(':memory:') as any,
      port: 0,
    });
  }

  test('wsAuthRequired=false: 无 Authorization 头也能尝试 upgrade (synthetic req)', async () => {
    delete process.env.BOUNTY_WS_AUTH_REQUIRED;
    buildServer();
    const res = await (server as any).handleRequest(
      new Request('http://localhost/ws?address=alice@host'),
      // upgrade() 在测试中会失败 — 但只要走到 upgrade 调用前没抛错 / 没返回 401 即可
      { upgrade: () => false } as any,
    );
    // upgrade() 返回 false 时 handleRequest 不返回新 Response（fall through），
    // 期待 404 (因为没 upgrade 也没匹配其他路由)
    expect(res.status).toBe(404);
  });

  test('wsAuthRequired=true: 无 Authorization 头 → 401', async () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = 'true';
    buildServer();
    const res = await (server as any).handleRequest(
      new Request('http://localhost/ws?address=alice@host'),
      { upgrade: () => false } as any,
    );
    expect(res.status).toBe(401);
  });

  test('wsAuthRequired=true: 坏 token → 401', async () => {
    process.env.BOUNTY_WS_AUTH_REQUIRED = 'true';
    buildServer();
    const res = await (server as any).handleRequest(
      new Request('http://localhost/ws?address=alice@host', {
        headers: { Authorization: 'Bearer bad.token.here' },
      }),
      { upgrade: () => false } as any,
    );
    expect(res.status).toBe(401);
  });
});