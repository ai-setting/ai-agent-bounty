/**
 * Tests for grab command's friendly handling of 409 Conflict (D.1 client).
 *
 * Phase: feat/bounty-task-optimize (Tier D.1)
 *
 * 设计动机: 当 server 返 409 + `currentOwner.email` 时，CLI 应当用人类可读
 * 的方式提示「任务已被 XXX 抢走」而不是直接打印 status code。
 *
 * Test strategy: use createBountyTestServer (real HTTP), let A grab a task,
 * then run grabCommand.handler() as B → server returns 409 → check console output.
 */

import { describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { createBountyTestServer, type BountyTestServerHandle } from '../../src/cli/lib/bounty-test-server.js';

describe('bounty bounty-task grab — 409 friendly message (D.1 client)', () => {
  let server: BountyTestServerHandle;
  let exitCode: number | null = null;
  let consoleErrorOutput: string[] = [];
  let originalImAddress: string | undefined;

  beforeEach(async () => {
    exitCode = null;
    consoleErrorOutput = [];
    originalImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_IM_ADDRESS;

    spyOn(console, 'error').mockImplementation((...args: any[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    });
    spyOn(process, 'exit').mockImplementation(((code?: number) => {
      exitCode = code ?? 0;
      throw new Error(`EXIT_${code ?? 0}`);
    }) as any);

    server = await createBountyTestServer({
      port: 0,
      // v0.10: seed agent ids must be valid UUIDs so the strict address match works
      seedAgents: [
        { id: '8de9b6aa-0000-4000-8000-000000000001', email: 'pub@test', name: 'Publisher', credits: 1000 },
        { id: '8de9b6aa-0000-4000-8000-000000000002', email: 'alice@example.com', name: 'Alice', credits: 0 },
        { id: '8de9b6aa-0000-4000-8000-000000000003', email: 'bob@example.com', name: 'Bob', credits: 0 },
      ],
    });
  });

  afterEach(async () => {
    if (server) await server.stop();
    (console.error as any).mockRestore?.();
    (process.exit as any).mockRestore?.();
    if (originalImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = originalImAddress;
    }
  });

  test('grab 409 → CLI should include friendly "task already grabbed" hint and exit 2', async () => {
    // 1) Publish a task
    const pubRes = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': '8de9b6aa-0000-4000-8000-000000000001' },
      body: JSON.stringify({ title: 'Race test', description: 'd', reward: 100, type: 'coding', publisherAddress: '8de9b6aa-0000-4000-8000-000000000001@host.local' }),
    });
    expect(pubRes.status).toBe(201);
    const task = (await pubRes.json()) as { id: string };

    // 2) Alice grabs it first (wins)
    const aliceGrab = await fetch(`${server.baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { 'X-Agent-Id': '8de9b6aa-0000-4000-8000-000000000002' },
    });
    expect(aliceGrab.status).toBe(200);

    // 3) Bob tries to grab via CLI → expect 409 → expect friendly hint
    // v0.10: Bob's BOUNTY_IM_ADDRESS must match a seeded agent (exact uuid@host)
    process.env.BOUNTY_IM_ADDRESS = '8de9b6aa-0000-4000-8000-000000000003@host.local';
    const { grabCommand } = await import('../../src/cli/commands/bounty-task/grab.js');

    // Intercept fetch to forward X-Agent-Id header (mock server reads agentId from
    // header in auth-OFF mode). The body's agentAddress is the canonical source.
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async (input: any, init?: any) => {
      const headers = new Headers(init?.headers ?? {});
      headers.set('X-Agent-Id', '8de9b6aa-0000-4000-8000-000000000003');
      return origFetch(input, { ...init, headers });
    };

    let thrown: any = null;
    try {
      await (grabCommand as any).handler({
        'task-id': task.id,
        'server-url': server.baseUrl,
      });
    } catch (e) {
      thrown = e;
    } finally {
      (globalThis as any).fetch = origFetch;
    }

    // Should have exited with code 2 (business error)
    expect(exitCode).toBe(2);
    expect(thrown?.message).toMatch(/EXIT_2/);

    // The error output should mention Alice (so user knows who beat them)
    const allOutput = consoleErrorOutput.join('\n');
    const mentionsAlice = allOutput.includes('alice@example.com') ||
                          allOutput.toLowerCase().includes('alice');
    const mentionsGrabbed = allOutput.toLowerCase().includes('grabbed') ||
                            allOutput.toLowerCase().includes('409');
    expect(mentionsAlice || mentionsGrabbed).toBe(true);
  });
});
