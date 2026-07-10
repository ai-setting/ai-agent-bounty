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

describe('auth/register-agent address flags and soft auth', () => {
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

  test('login commands expose --agent-address and keep deprecated --agent-id', () => {
    for (const srcPath of [AUTH_LOGIN_SRC, REGISTER_LOGIN_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain('agent-address');
      expect(src).toContain('agent-id');
    }
  });

  test('register-agent get/delete/info/credits expose --agent-address and keep deprecated id alias', () => {
    for (const srcPath of [REGISTER_GET_SRC, REGISTER_DELETE_SRC, REGISTER_INFO_SRC, REGISTER_CREDITS_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain('agent-address');
      expect(src).toContain("'id'");
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

  test('auth login parses --agent-address to agent_id request body', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ agent_id: body.agent_id, email: 'agent@example.com', expires_in: 3600 });
      },
    });

    const { loginCommand } = await import('../../src/cli/commands/auth/login.js');
    await (loginCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'agent-address': 'login-agent@host.test',
    });

    expect(requests[0].path).toBe('/api/auth/login');
    expect(requests[0].body.agent_id).toBe('login-agent');
  });
});
