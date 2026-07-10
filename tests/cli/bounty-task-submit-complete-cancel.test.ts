/**
 * Tests for `bounty bounty-task submit/complete/cancel` CLI commands — HTTP API migration.
 *
 * Phase: feat/bounty-task-optimize
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SUBMIT_SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/submit.ts');
const COMPLETE_SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/complete.ts');
const CANCEL_SRC = resolve(import.meta.dir, '../../src/cli/commands/bounty-task/cancel.ts');

describe('bounty bounty-task submit - HTTP API migration', () => {
  test('source uses bountyHttp (not createContext)', () => {
    const src = readFileSync(SUBMIT_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/bounty-http.js'");
    expect(src).not.toContain("from '../../services/context.js'");
  });

  test('source has --server-url / -u option via addServerUrlOption', () => {
    const src = readFileSync(SUBMIT_SRC, 'utf-8');
    expect(src).toContain("addServerUrlOption");
    expect(src).toContain("resolveServerUrl");
  });

  test('source PUT /api/tasks/:id/submit with result body', () => {
    const src = readFileSync(SUBMIT_SRC, 'utf-8');
    expect(src).toContain("/api/tasks");
    expect(src).toContain("/submit");
    expect(src).toMatch(/method:\s*['"]PUT['"]/);
    expect(src).toContain("result:");
  });

  test('source uses resolveCurrentAgent as default for --agent-id', () => {
    const src = readFileSync(SUBMIT_SRC, 'utf-8');
    expect(src).toContain("resolveCurrentAgent");
  });
});

describe('bounty bounty-task complete - HTTP API migration', () => {
  test('source uses bountyHttp (not createContext)', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/bounty-http.js'");
    expect(src).not.toContain("from '../../services/context.js'");
  });

  test('source has --server-url / -u option via addServerUrlOption', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    expect(src).toContain("addServerUrlOption");
    expect(src).toContain("resolveServerUrl");
  });

  test('source PUT /api/tasks/:id/complete', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    expect(src).toContain("/api/tasks");
    expect(src).toContain("/complete");
    expect(src).toMatch(/method:\s*['"]PUT['"]/);
  });

  test('source uses resolveCurrentAgent as default for --publisher-id', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    expect(src).toContain("resolveCurrentAgent");
  });

  // v0.7.2 regression: server's resolveActor('publisher') reads body.publisherId or
  // body.publisherAddress; sending { agentId } triggers "publisherId or publisherAddress required".
  test('body uses publisherId (server resolveActor contract)', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    // Must send publisherId/publisherAddress, not agentId
    expect(src).toMatch(/body:\s*\{\s*publisherId\s*\}/);
    expect(src).not.toMatch(/body:\s*\{\s*agentId\s*\}/);
  });
});

describe('bounty bounty-task cancel - HTTP API migration', () => {
  test('source uses bountyHttp (not createContext)', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/bounty-http.js'");
    expect(src).not.toContain("from '../../services/context.js'");
  });

  test('source has --server-url / -u option via addServerUrlOption', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toContain("addServerUrlOption");
    expect(src).toContain("resolveServerUrl");
  });

  test('source PUT /api/tasks/:id/cancel', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toContain("/api/tasks");
    expect(src).toContain("/cancel");
    expect(src).toMatch(/method:\s*['"]PUT['"]/);
  });

  // v0.7.2 regression: server's resolveActor('publisher') reads body.publisherId or
  // body.publisherAddress; sending { agentId } triggers "publisherId or publisherAddress required".
  test('body uses publisherId (server resolveActor contract)', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toMatch(/body:\s*\{\s*publisherId\s*\}/);
    expect(src).not.toMatch(/body:\s*\{\s*agentId\s*\}/);
  });
});

// Dynamic HTTP integration tests using mock server
describe('bounty bounty-task submit/complete/cancel - HTTP integration', () => {
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

  test('submit: PUT /api/tasks/:id/submit with { agentId, result } body', async () => {
    let capturedBody: any = null;
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        return new Promise(async (resolveOuter) => {
          capturedBody = await req.json().catch(() => ({}));
          resolveOuter(Response.json({ id: 'task-1', status: 'submitted' }));
        });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks/task-1/submit',
      method: 'PUT',
      body: { agentId: 'a-1', result: 'My work result' },
    });

    expect(result.status).toBe('submitted');
    expect(capturedBody.agentId).toBe('a-1');
    expect(capturedBody.result).toBe('My work result');
  });

  test('complete: PUT /api/tasks/:id/complete with { agentId } body', async () => {
    let capturedBody: any = null;
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        return new Promise(async (resolveOuter) => {
          capturedBody = await req.json().catch(() => ({}));
          resolveOuter(Response.json({ id: 'task-1', status: 'completed' }));
        });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks/task-1/complete',
      method: 'PUT',
      body: { agentId: 'publisher-1' },
    });

    expect(result.status).toBe('completed');
    expect(capturedBody.agentId).toBe('publisher-1');
  });

  test('cancel: PUT /api/tasks/:id/cancel with { agentId } body', async () => {
    let capturedBody: any = null;
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        return new Promise(async (resolveOuter) => {
          capturedBody = await req.json().catch(() => ({}));
          resolveOuter(Response.json({ id: 'task-1', status: 'cancelled' }));
        });
      },
    });

    const { bountyHttp } = await import('../../src/cli/lib/bounty-http.js');
    const result: any = await bountyHttp({
      baseUrl: `http://localhost:${mockServer.port}`,
      path: '/api/tasks/task-1/cancel',
      method: 'PUT',
      body: { agentId: 'publisher-1' },
    });

    expect(result.status).toBe('cancelled');
    expect(capturedBody.agentId).toBe('publisher-1');
  });
});