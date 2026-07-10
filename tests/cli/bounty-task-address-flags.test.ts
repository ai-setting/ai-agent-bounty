import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const VALID_TASK_ID = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';
const TASK_COMMANDS = {
  publish: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/publish.ts'),
  grab: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts'),
  submit: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts'),
  complete: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts'),
  cancel: resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts'),
};

describe('bounty-task address-based flags', () => {
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

  test('source exposes preferred address flags while keeping deprecated id aliases', () => {
    expect(readFileSync(TASK_COMMANDS.publish, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.publish, 'utf-8')).toContain('publisher-id');
    expect(readFileSync(TASK_COMMANDS.grab, 'utf-8')).toContain('agent-address');
    expect(readFileSync(TASK_COMMANDS.grab, 'utf-8')).toContain('agent-id');
    expect(readFileSync(TASK_COMMANDS.submit, 'utf-8')).toContain('agent-address');
    expect(readFileSync(TASK_COMMANDS.submit, 'utf-8')).toContain('agent-id');
    expect(readFileSync(TASK_COMMANDS.complete, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.complete, 'utf-8')).toContain('publisher-id');
    expect(readFileSync(TASK_COMMANDS.cancel, 'utf-8')).toContain('publisher-address');
    expect(readFileSync(TASK_COMMANDS.cancel, 'utf-8')).toContain('publisher-id');
  });

  test('publish parses --publisher-address to publisherId and does not require description', async () => {
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
          id: 'task-v07',
          title: body.title,
          description: body.description,
          type: body.type,
          reward: body.reward,
          publisherId: body.publisherId,
          status: 'open',
        }, { status: 201 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    await (publishCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-address': 'ee0dd085-0b66-4640-81bc-f8d4c743c1e6@bounty.tongagents.example.com',
      title: 'v0.7 test',
      type: 'writing',
      reward: 5,
      json: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/api/tasks');
    expect(requests[0].body.publisherId).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
    expect(requests[0].body.description).toBeUndefined();
    expect(requests[0].headers['x-agent-id']).toBe('ee0dd085-0b66-4640-81bc-f8d4c743c1e6');
  });

  test('publish deprecated --publisher-id still works and warns', async () => {
    const warnings: string[] = [];
    (console.warn as any).mockRestore?.();
    spyOn(console, 'warn').mockImplementation((...args: any[]) => warnings.push(args.map(String).join(' ')));

    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: 'task-legacy', title: body.title, type: body.type, reward: body.reward, publisherId: body.publisherId, status: 'open' }, { status: 201 });
      },
    });

    const { publishCommand } = await import('../../src/cli/commands/bounty-task/publish.js');
    await (publishCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'publisher-id': 'legacy-publisher',
      title: 'legacy',
      type: 'writing',
      reward: 5,
      json: true,
    });

    expect(requests[0].body.publisherId).toBe('legacy-publisher');
    expect(warnings.some((w) => w.includes('--publisher-id is deprecated'))).toBe(true);
  });

  test('grab parses --agent-address to agentId and X-Agent-Id', async () => {
    mockServer = Bun.serve({
      port: 0,
      async fetch(req) {
        const body = await req.json().catch(() => ({}));
        requests.push({ path: new URL(req.url).pathname, method: req.method, body, headers: Object.fromEntries(req.headers.entries()) });
        return Response.json({ id: VALID_TASK_ID, status: 'grabbed', assigneeId: body.agentId });
      },
    });

    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');
    await (grabCommand as any).handler({
      'server-url': `http://localhost:${mockServer.port}`,
      'task-id': VALID_TASK_ID,
      'agent-address': 'agent-abc@host.test',
    });

    expect(requests[0].path).toBe(`/api/tasks/${VALID_TASK_ID}/grab`);
    expect(requests[0].body.agentId).toBe('agent-abc');
    expect(requests[0].headers['x-agent-id']).toBe('agent-abc');
  });
});
