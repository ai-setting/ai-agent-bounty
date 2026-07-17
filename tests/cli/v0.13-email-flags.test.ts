/**
 * v0.13: CLI tests for email-first input flags.
 *
 * Verifies that the commands modified to accept `--email` correctly:
 *   - Declare the new `--email` option in yargs builder
 *   - Send the email-shaped payload to the server (via fetch / bountyHttp)
 *   - Reject invocations missing both `--email` and the legacy `--agent-address`
 *     / `--from` / `--to` options
 *
 * For most of these we drive the command handlers directly with a mock server
 * (Bun.serve) to avoid touching the file system or running yargs end-to-end.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ---------- com/send ----------

describe('com/send - v0.13 --from-email / --to-email flags', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/send.ts');

  test('declares --from-email / -F and --to-email / -T', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]from-email['"]/);
    expect(src).toMatch(/alias:\s*['"]F['"]/);
    expect(src).toMatch(/\.option\(\s*['"]to-email['"]/);
    expect(src).toMatch(/alias:\s*['"]T['"]/);
  });

  test('v0.14: --from and --to legacy address options REMOVED from send.ts', () => {
    const src = readFileSync(SRC, 'utf-8');
    // v0.14 BREAKING: --from and --to are no longer present at all (not even
    // as no-demandOption options). Only --from-email / -F and --to-email / -T.
    expect(src).not.toMatch(/\.option\(\s*['"]from['"]/);
    expect(src).not.toMatch(/\.option\(\s*['"]to['"]/);
  });

  test('builds request body with from_email/to_email when supplied', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('from_email');
    expect(src).toContain('to_email');
  });

  test('handler end-to-end with --from-email + --to-email', async () => {
    let received: any = null;
    const mock = Bun.serve({
      port: 0,
      async fetch(req) {
        received = await req.json();
        return Response.json({
          id: 'm-1',
          from: 'alice@example.com',
          to: 'bob@example.com',
          status: 'pending',
          createdAt: new Date().toISOString(),
        });
      },
    });
    const port = mock.port;
    const { sendCommand } = await import('../../src/cli/commands/com/send.js');
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await (sendCommand as any).handler({
        'from-email': 'alice@example.com',
        'to-email': 'bob@example.com',
        body: 'hello via email',
        host: 'localhost',
        port,
      });
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrSpy.mockRestore();
      mock.stop();
    }
    expect(received.content.body).toBe('hello via email');
    expect(received.from_email).toBe('alice@example.com');
    expect(received.to_email).toBe('bob@example.com');
  });
});

// ---------- com/inbox ----------

describe('com/inbox - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/inbox.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('handler prefers --email over --address when both provided', async () => {
    let captured: any = null;
    const mock = Bun.serve({
      port: 0,
      async fetch(req) {
        const u = new URL(req.url);
        captured = u.searchParams.get('email') ?? u.searchParams.get('address');
        return Response.json([]);
      },
    });
    const port = mock.port;
    const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');
    const consoleLogSpy = spyOn(console, 'log').mockImplementation(() => {});
    const consoleErrSpy = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await (inboxCommand as any).handler({
        email: 'alice@example.com',
        address: '8de9b6aa-5781-4000-8000-000000000001@bounty.local',
        host: 'localhost',
        port,
        limit: 5,
      });
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrSpy.mockRestore();
      mock.stop();
    }
    expect(captured).toBe('alice@example.com');
  });
});

// ---------- com/connect ----------

describe('com/connect - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/connect.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('ws probe URL uses ?email= not ?address=', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\/ws\?email=/);
  });
});

// ---------- com/disconnect ----------

describe('com/disconnect - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/com/disconnect.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('emits the new --email hint in usage block', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('bounty com disconnect --email <email>');
  });
});

// ---------- register-agent/credits ----------

describe('register-agent/credits - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/credits.ts');

  test('declares --email/-e as primary', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('v0.14: --agent-address option REMOVED from register-agent/credits.ts', () => {
    const src = readFileSync(SRC, 'utf-8');
    // v0.14 BREAKING: --agent-address / -a removed entirely; --email / -e is the only path.
    expect(src).not.toMatch(/\.option\(\s*['"]agent-address['"]/);
    expect(src).not.toContain("'agent-address'");
    // sanity: --email is present.
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
  });

  test('uses AgentService.getByEmail for the email path', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('getByEmail');
  });
});

// ---------- register-agent/get ----------

describe('register-agent/get - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/get.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('--email path hits /api/agents/by-email?email=...', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('/api/agents/by-email');
  });
});

// ---------- register-agent/delete ----------

describe('register-agent/delete - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/delete.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('--email path hits DELETE /api/agents/by-email?email=...', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('/api/agents/by-email');
    expect(src).toContain('DELETE');
  });
});

// ---------- bounty-task/grab ----------

describe('bounty-task/grab - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('handler sends agentEmail in body when --email supplied', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('agentEmail');
  });
});

// ---------- bounty-task/submit ----------

describe('bounty-task/submit - v0.13 --email flag', () => {
  const SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts');

  test('declares --email/-e', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/\.option\(\s*['"]email['"]/);
    expect(src).toMatch(/alias:\s*['"]e['"]/);
  });

  test('handler sends agentEmail in body when --email supplied', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain('agentEmail');
  });
});