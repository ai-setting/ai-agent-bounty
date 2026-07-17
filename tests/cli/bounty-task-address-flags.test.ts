/**
 * v0.10 STRICT address-based flag tests for bounty-task commands.
 *
 * v0.10 BREAKING:
 * - `--agent-id` / `--publisher-id` REMOVED entirely
 * - Only `--*-address <uuid>@<host>` accepted
 * - Body sends full `*Address` (uuid@host) — NOT just bare uuid
 * - `X-Agent-Id` header carries bare uuid (soft-auth compatibility)
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VALID_TASK_ID = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
const PUB_UUID = '8de9b6aa-1111-4000-8000-000000000001';
const AGENT_UUID = '8de9b6aa-2222-4000-8000-000000000002';
const PUB_FULL = `${PUB_UUID}@bounty.tongagents.example.com`;
const AGENT_FULL = `${AGENT_UUID}@host.test`;

const TASK_COMMANDS = {
  publish: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts'),
  grab: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts'),
  submit: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts'),
  complete: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts'),
  cancel: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts'),
};

describe('bounty-task address-based flags (v0.10 strict)', () => {
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

  test('source exposes ONLY preferred address flags (v0.10 BREAKING: --*-id REMOVED)', () => {
    // publish / complete / cancel: must have publisher-address, MUST NOT have publisher-id
    expect(readFileSync(TASK_COMMANDS.publish, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.publish, 'utf-8')).not.toContain(".option('publisher-id'");
    expect(readFileSync(TASK_COMMANDS.complete, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.complete, 'utf-8')).not.toContain(".option('publisher-id'");
    expect(readFileSync(TASK_COMMANDS.cancel, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.cancel, 'utf-8')).not.toContain(".option('publisher-id'");
    // grab / submit: must have agent-address, MUST NOT have agent-id
    expect(readFileSync(TASK_COMMANDS.grab, 'utf-8')).toContain('agent-address');
    expect(readFileSync(TASK_COMMANDS.grab, 'utf-8')).not.toContain(".option('agent-id'");
    expect(readFileSync(TASK_COMMANDS.submit, 'utf-8')).toContain('agent-address');
    expect(readFileSync(TASK_COMMANDS.submit, 'utf-8')).not.toContain(".option('agent-id'");
  });

  test('publish: parses --publisher-address <uuid>@<host> → body.publisherAddress (full address, NOT uuid)', async () => {
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
          id: 'task-v010',
          title: body.title,
          description: body.description,
          type: body.type,
          reward: body.reward,
          publisherId: PUB_UUID,
          status: 'open',
        }, { status: 201 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    await (publishCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-address': PUB_FULL,
      title: 'v0.10 strict test',
      type: 'writing',
      reward: 5,
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/tasks');
    // v0.10 BREAKING: body carries full uuid@host (NOT bare uuid, NOT publisherId field)
    expect(requests[0].body.publisherAddress).toBe(PUB_FULL);
    expect(requests[0].body.publisherId).toBeUndefined();
    // X-Agent-Id header carries bare uuid (soft-auth)
    expect(requests[0].headers['x-agent-id']).toBe(PUB_UUID);
  });

  test('grab: parses --agent-address <uuid>@<host> → body.agentAddress (full address, NOT uuid)', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'grabbed', assigneeId: AGENT_UUID });
      },
    });

    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');
    await (grabCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'task-id': VALID_TASK_ID,
      'agent-address': AGENT_FULL,
    });

    expect(requests[0].path).toBe(`/api/tasks/${VALID_TASK_ID}/grab`);
    // v0.10 BREAKING: body carries full uuid@host
    expect(requests[0].body.agentAddress).toBe(AGENT_FULL);
    expect(requests[0].body.agentId).toBeUndefined();
    // v0.13: when --email not supplied, X-Agent-Id header is no longer set
    // (the v0.10 soft-auth hint via X-Agent-Id was removed because the
    // server now resolves identity via body.agentEmail/agentAddress).
    expect(requests[0].headers['x-agent-id']).toBeUndefined();
  });
});
