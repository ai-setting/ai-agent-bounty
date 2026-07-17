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

  test('source uses requireEmailFlag helper (v0.14: resolveCurrentAgent REMOVED)', () => {
    const src = readFileSync(SUBMIT_SRC, 'utf-8');
    // v0.14: --email flow is centralised via requireEmailFlag; resolveCurrentAgent is gone.
    expect(src).toContain("requireEmailFlag");
    expect(src).not.toContain("resolveCurrentAgent");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });
});

describe('bounty bounty-task complete - HTTP API migration (v0.14)', () => {
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

  test('source uses requireEmailFlag helper (v0.14: resolveCurrentAgent REMOVED)', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    // v0.14: --publisher-email flow is centralised via requireEmailFlag; resolveCurrentAgent is gone.
    expect(src).toContain("requireEmailFlag");
    expect(src).not.toContain("resolveCurrentAgent");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });

  // v0.14 BREAKING: server's resolveActor('publisher') reads ONLY body.publisherEmail.
  test('body uses publisherEmail (v0.14 strict email-only contract)', () => {
    const src = readFileSync(COMPLETE_SRC, 'utf-8');
    // Must send publisherEmail (registered email), not publisherAddress / publisherId
    expect(src).toMatch(/body:\s*\{[^}]*publisherEmail\s*[,}]/);
    expect(src).not.toMatch(/body:\s*\{\s*publisherAddress\s*[,}]/);
    expect(src).not.toMatch(/body:\s*\{\s*publisherId\s*[,}]/);
  });
});

describe('bounty bounty-task cancel - HTTP API migration (v0.14)', () => {
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

  // v0.14 BREAKING: server's resolveActor('publisher') reads ONLY body.publisherEmail.
  test('body uses publisherEmail (v0.14 strict email-only contract)', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toMatch(/body:\s*\{[^}]*publisherEmail\s*[,}]/);
    expect(src).not.toMatch(/body:\s*\{\s*publisherAddress\s*[,}]/);
    expect(src).not.toMatch(/body:\s*\{\s*publisherId\s*[,}]/);
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

  test('submit: PUT /api/tasks/:id/submit with { agentEmail, result } body (v0.14)', async () => {
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
      body: { agentEmail: 'bob@example.com', result: 'My work result' },
    });

    expect(result.status).toBe('submitted');
    expect(capturedBody.agentEmail).toBe('bob@example.com');
    expect(capturedBody.agentId).toBeUndefined();
    expect(capturedBody.result).toBe('My work result');
  });

  test('complete: PUT /api/tasks/:id/complete with { publisherEmail } body (v0.14)', async () => {
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
      body: { publisherEmail: 'alice@example.com' },
    });

    expect(result.status).toBe('completed');
    expect(capturedBody.publisherEmail).toBe('alice@example.com');
    expect(capturedBody.agentId).toBeUndefined();
    expect(capturedBody.publisherAddress).toBeUndefined();
  });

  test('cancel: PUT /api/tasks/:id/cancel with { publisherEmail } body (v0.14)', async () => {
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
      body: { publisherEmail: 'alice@example.com' },
    });

    expect(result.status).toBe('cancelled');
    expect(capturedBody.publisherEmail).toBe('alice@example.com');
    expect(capturedBody.agentId).toBeUndefined();
    expect(capturedBody.publisherAddress).toBeUndefined();
  });
});