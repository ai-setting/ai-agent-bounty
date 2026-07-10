/**
 * Tests for `bounty bounty-task grab` CLI command — HTTP API migration.
 *
 * Phase: feat/bounty-task-optimize
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/grab.ts');

describe('bounty bounty-task grab - HTTP API migration', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;

  beforeEach(() => {
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
  });

  test('source uses bountyHttp (not createContext)', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/bounty-http.js'");
    expect(src).not.toContain("from '../../services/context.js'");
  });

  test('source has --server-url / -u option via addServerUrlOption', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("addServerUrlOption");
    expect(src).toContain("resolveServerUrl");
  });

  test('source uses PUT method with /grab path', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("/api/tasks");
    expect(src).toContain("/grab");
    expect(src).toMatch(/method:\s*['"]PUT['"]/);
  });

  test('source uses resolveCurrentAgent as default for --agent-id', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("resolveCurrentAgent");
  });

  test('T1: grabs task via HTTP PUT /api/tasks/:id/grab', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return Response.json({
          id: url.pathname.split('/')[3],
          title: 'Mock task',
          status: 'grabbed',
          assigneeId: 'mock-agent',
        });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const task: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks/task-abc/grab',
      method: 'PUT',
      body: { agentId: 'mock-agent' },
    });

    expect(task.id).toBe('task-abc');
    expect(task.status).toBe('grabbed');
  });

  test('T2: 404 propagates as BountyHttpError(type=business)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Task not found' }, { status: 404 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks/missing/grab',
        method: 'PUT',
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('business');
      expect(e.serverMessage).toContain('Task not found');
    }
  });

  test('T3: 400 (already grabbed) propagates as BountyHttpError(type=business)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json({ error: 'Task already grabbed' }, { status: 400 });
      },
    });

    const { bountyHttp, BountyHttpError } = await import('../../src/cli/lib/bounty-http.js');
    try {
      await bountyHttp({
        baseUrl: `http://localhost:${mockServer.port}`,
        path: '/api/tasks/x/grab',
        method: 'PUT',
      });
      expect(true).toBe(false);
    } catch (e: any) {
      expect(e).toBeInstanceOf(BountyHttpError);
      expect(e.type).toBe('business');
      expect(e.serverMessage).toContain('already grabbed');
    }
  });
});