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

const UUID_A = '8de9b6aa-1111-4000-8000-000000000001';
const UUID_B = '8de9b6aa-2222-4000-8000-000000000002';
const ADDR_A = `${UUID_A}@bounty.example.com`;
const ADDR_B = `${UUID_B}@bounty.example.com`;

describe('auth/register-agent address flags and soft auth (v0.10)', () => {
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

  test('login commands expose --agent-address only (v0.10 BREAKING: --agent-id REMOVED)', () => {
    for (const srcPath of [AUTH_LOGIN_SRC, REGISTER_LOGIN_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain('agent-address');
      // v0.10: --agent-id / agent-id option REMOVED
      expect(src).not.toContain("'agent-id'");
    }
  });

  test('register-agent get/delete/info/credits expose --agent-address only (v0.10)', () => {
    for (const srcPath of [REGISTER_GET_SRC, REGISTER_DELETE_SRC, REGISTER_INFO_SRC, REGISTER_CREDITS_SRC]) {
      const src = readFileSync(srcPath, 'utf-8');
      expect(src).toContain('agent-address');
      // v0.10: --id / -i option REMOVED
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

  test('v0.10: auth login parses --agent-address <uuid>@<host> to body.agent_id (uuid portion)', async () => {
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
      'agent-address': ADDR_A,
    });

    expect(requests[0].path).toBe('/api/auth/login');
    expect(requests[0].body.agent_id).toBe(UUID_A);  // uuid portion extracted
  });

  test('v0.10 BREAKING: auth login REJECTS bare UUID --agent-address', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ agent_id: body.agent_id, email: 'agent@example.com', expires_in: 3600 });
      },
    });

    // Spy process.exit AND console.error to prevent the runner from being killed
    const exitMessages: string[] = [];
    const consoleErrorSpy = spyOn(console, 'error').mockImplementation((...args: any[]) => {
      exitMessages.push(args.map(String).join(' '));
    });
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
          'agent-address': UUID_B,  // bare UUID — REJECTED in v0.10
        });
      } catch (e) {
        thrown = e;
      }

      // Bare UUID triggers parseAddress to fail → exit(2)
      expect(thrown?.message).toMatch(/EXIT_2/);
      expect(exitCode).toBe(2);
      // Should NOT have hit the mock server (validation fails client-side)
      expect(requests.length).toBe(0);
    } finally {
      exitSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });
});
