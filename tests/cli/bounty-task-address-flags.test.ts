/**
 * v0.14 STRICT email-based flag tests for bounty-task commands.
 *
 * v0.14 BREAKING:
 * - `--agent-address` / `--publisher-address` / `--*-id` REMOVED entirely
 * - Only `--*-email <registered-email>` accepted
 * - Body sends `*Email` ONLY (registered email string)
 * - `X-Agent-Id` soft-auth header REMOVED (publisherEmail in body is canonical)
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VALID_TASK_ID = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
const PUB_EMAIL = 'alice@example.com';
const AGENT_EMAIL = 'bob@example.com';

const TASK_COMMANDS = {
  publish: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts'),
  grab: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts'),
  submit: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts'),
  complete: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts'),
  cancel: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts'),
};

describe('bounty-task email-based flags (v0.14 strict)', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let requests: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];

  beforeEach(() => {
    requests = [];
    delete process.env.BOUNTY_IM_ADDRESS;
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

  test('source exposes ONLY preferred email flags (v0.14 BREAKING: --*-address / --*-id REMOVED)', () => {
    // publish / complete / cancel: must have publisher-email, MUST NOT have publisher-address / publisher-id
    for (const cmd of ['publish', 'complete', 'cancel']) {
      const src = readFileSync(TASK_COMMANDS[cmd as keyof typeof TASK_COMMANDS], 'utf-8');
      expect(src).toContain('publisher-email');
      expect(src).not.toContain(".option('publisher-address'");
      expect(src).not.toContain(".option('publisher-id'");
    }
    // grab / submit: must have email, MUST NOT have agent-address / agent-id
    for (const cmd of ['grab', 'submit']) {
      const src = readFileSync(TASK_COMMANDS[cmd as keyof typeof TASK_COMMANDS], 'utf-8');
      expect(src).toContain("'email'");
      expect(src).not.toContain(".option('agent-address'");
      expect(src).not.toContain(".option('agent-id'");
    }
  });

  test('publish: parses --publisher-email <email> → body.publisherEmail (email-shaped, NOT address)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        const body = await req.json().catch(() => ({}));
        requests.push({
          path: url.pathname,
          method: req.method,
          body,
          headers: Object.fromEntries(req.headers.entries()),
        });
        return Response.json({
          id: 'task-v014',
          title: body.title,
          description: body.description,
          type: body.type,
          reward: body.reward,
          publisherId: '8de9b6aa-1111-4000-8000-000000000001',
          status: 'open',
        }, { status: 201 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    await (publishCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-email': PUB_EMAIL,
      title: 'v0.14 strict test',
      type: 'writing',
      reward: 5,
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/tasks');
    // v0.14 BREAKING: body carries email ONLY (NOT publisherAddress / publisherId field)
    expect(requests[0].body.publisherEmail).toBe(PUB_EMAIL);
    expect(requests[0].body.publisherAddress).toBeUndefined();
    expect(requests[0].body.publisherId).toBeUndefined();
    // v0.14: X-Agent-Id soft-auth header REMOVED (publisherEmail in body is canonical)
    expect(requests[0].headers['x-agent-id']).toBeUndefined();
  });

  test('grab: parses --email <email> → body.agentEmail (email-shaped, NOT address)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'grabbed', assigneeId: AGENT_EMAIL });
      },
    });

    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');
    await (grabCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      email: AGENT_EMAIL,
      'task-id': VALID_TASK_ID,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.agentEmail).toBe(AGENT_EMAIL);
    expect(requests[0].body.agentAddress).toBeUndefined();
    expect(requests[0].headers['x-agent-id']).toBeUndefined();
  });

  test('submit: parses --email <email> → body.agentEmail (email-shaped)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'submitted', title: 't' });
      },
    });

    const { submitCommand } = await import('../../src/cli/commands/bounty-task/submit.js');
    await (submitCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      email: AGENT_EMAIL,
      'task-id': VALID_TASK_ID,
      result: 'task completed successfully',
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.agentEmail).toBe(AGENT_EMAIL);
    expect(requests[0].body.agentAddress).toBeUndefined();
    expect(requests[0].body.result).toBe('task completed successfully');
  });

  test('complete: parses --publisher-email <email> → body.publisherEmail', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'completed' });
      },
    });

    const { completeCommand } = await import('../../src/cli/commands/bounty-task/complete.js');
    await (completeCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-email': PUB_EMAIL,
      'task-id': VALID_TASK_ID,
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.publisherEmail).toBe(PUB_EMAIL);
    expect(requests[0].body.publisherAddress).toBeUndefined();
  });

  test('cancel: parses --publisher-email <email> → body.publisherEmail', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'cancelled' });
      },
    });

    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');
    await (cancelCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-email': PUB_EMAIL,
      'task-id': VALID_TASK_ID,
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].body.publisherEmail).toBe(PUB_EMAIL);
    expect(requests[0].body.publisherAddress).toBeUndefined();
  });
});
