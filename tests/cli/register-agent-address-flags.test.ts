/**
 * v0.14 STRICT email-only flag tests for auth/register-agent commands.
 *
 * v0.14 BREAKING:
 * - `--agent-address / -a` REMOVED entirely across auth/login,
 *   register-agent/{login,get,delete,info,credits}.
 * - Only `--email / -e` accepted (registered email).
 * - Lookup is exclusively via `/api/agents/by-email?email=<email>`.
 * - X-Agent-Id soft-auth header REMOVED (email in body is canonical).
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const AUTH_LOGIN_SRC = resolve(import.meta.dir, '../../src/cli/commands/auth/login.ts');
const REGISTER_LOGIN_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/login.ts');
const REGISTER_GET_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/get.ts');
const REGISTER_DELETE_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/delete.ts');
const REGISTER_LIST_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/list.ts');
const REGISTER_INFO_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/info.ts');
const REGISTER_CREDITS_SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/credits.ts');

const EMAIL_A = 'alice@example.com';
const EMAIL_B = 'bob@example.com';

describe('auth/register-agent email flags and soft auth (v0.14)', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let requests: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];

  beforeEach(() => {
    requests = [];
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    (console.log as any).mockRestore?.();
    (console.warn as any).mockRestore?.();
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
  });

  test('login commands expose --email only (v0.14 BREAKING: --agent-address REMOVED)', () => {
    for (const srcPath of [AUTH_LOGIN_SRC, REGISTER_LOGIN_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain("'email'");
      // v0.14: --agent-address / -a REMOVED
      expect(src).not.toContain("'agent-address'");
      expect(src).not.toContain('.option(\'agent-address\'');
    }
  });

  test('register-agent get/delete/info/credits expose --email only (v0.14)', () => {
    for (const srcPath of [REGISTER_GET_SRC, REGISTER_DELETE_SRC, REGISTER_INFO_SRC, REGISTER_CREDITS_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain("'email'");
      expect(src).not.toContain('.option(\'agent-address\'');
      // v0.14: --id / -i option REMOVED
      expect(src).not.toContain(".option('id'");
    }
  });

  test('register-agent get/list/delete no longer hard-fail on missing local token', () => {
    for (const srcPath of [REGISTER_GET_SRC, REGISTER_DELETE_SRC, REGISTER_LIST_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).not.toContain('No token found. Please login first');
      expect(src).not.toContain('loadToken');
      expect(src).toContain('attachSoftAuth');
    }
  });

  test('v0.14: auth login sends body.email ONLY (no agent_id field)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ agent_id: '8de9b6aa-1111-4000-8000-000000000001', email: body.email, expires_in: 3600 });
      },
    });

    const { loginCommand } = await import('../../src/cli/commands/auth/login.js');
    await (loginCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      email: EMAIL_A,
    });

    expect(requests[0].path).toBe('/api/auth/login');
    expect(requests[0].body.email).toBe(EMAIL_A);
    // v0.14: agent_id / agentAddress REMOVED from body.
    expect(requests[0].body.agent_id).toBeUndefined();
    expect(requests[0].body.agentAddress).toBeUndefined();
  });

  test('v0.14 BREAKING: auth login REJECTS bare UUID --agent-address (becomes unknown option)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ agent_id: '8de9b6aa-2222-4000-8000-000000000002', email: 'agent@example.com', expires_in: 3600 });
      },
    });

    const consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {});
    let exitCode: number | undefined;
    const exitSpy = spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any);

    try {
      const { loginCommand } = await import('../../src/cli/commands/auth/login.js');

      let thrown: any = null;
      try {
        await (loginCommand as any).handler({
          'server-url': `http://localhost:${mockServer.port}`,
          'agent-address': '8de9b6aa-2222-4000-8000-000000000002',
        });
      } catch (e) {
        thrown = e;
      }
      expect(thrown).not.toBeNull();
      expect(exitCode).toBe(1);
      expect(requests.length).toBe(0); // no request was made — exit before fetch
    } finally {
      consoleErrorSpy.mockRestore?.();
      exitSpy.mockRestore?.();
    }
  });

  test('v0.14: register-agent get uses /api/agents/by-email?email=<email>', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json().catch(() => ({}));
        requests.push({ path: url.pathname + url.search, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({
          id: '8de9b6aa-1111-4000-8000-000000000001',
          name: 'Alice',
          email: url.searchParams.get('email'),
          status: 'active',
          credits: 0,
          created_at: 0,
        });
      },
    });

    const { getCommand } = await import('../../src/cli/commands/register-agent/get.js');
    await (getCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      email: EMAIL_B,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/agents/by-email?email=' + encodeURIComponent(EMAIL_B));
  });
});
