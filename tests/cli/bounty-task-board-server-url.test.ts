/**
 * Tests for `bounty bounty-task board` CLI command — HTTP API migration.
 *
 * Phase: feat/bounty-task-optimize
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/board.ts');

describe('bounty bounty-task board - HTTP API migration', () => {
  let mockServer: ReturnType<typeof Bun.serve> | null = null;

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

  test('source GET /api/tasks with query string for filters', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("/api/tasks");
    expect(src).toMatch(/method:\s*['"]GET['"]/);
    // Filter mapping: type/minReward/maxReward → query string via URLSearchParams
    expect(src).toMatch(/URLSearchParams/);
    expect(src).toContain('params.set');
  });

  test('T1: lists open tasks via GET /api/tasks', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        return Response.json([
          { id: 't1', title: 'Task 1', type: 'coding', reward: 100, status: 'open', publisherEmail: 'a@b' },
          { id: 't2', title: 'Task 2', type: 'writing', reward: 50, status: 'open', publisherEmail: 'c@d' },
        ]);
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const tasks: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks?status=open',
      method: 'GET',
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[0].id).toBe('t1');
  });

  test('T2: passes type filter as query string', async () => {
    let capturedQuery = '';
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        capturedQuery = new URL(req.url).search;
        return Response.json([]);
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks?type=coding',
      method: 'GET',
    });

    expect(capturedQuery).toBe('?type=coding');
  });

  test('T3: empty board returns empty array (no error)', async () => {
    mockServer = Bun.serve({
      port: 0,
      fetch() {
        return Response.json([]);
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const tasks: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks',
      method: 'GET',
    });

    expect(tasks).toEqual([]);
  });
});