/**
 * Tests for `bounty bounty-task cancel` CLI command — PR7 ProfileContext wiring.
 *
 * Mirrors the PR3 auth/* shape:
 * - cancel must use `resolveProfileApiBase` helper
 * - cancel must read `ProfileContext.getActive()`
 * - cancel must NOT read `bountyConfig.apiUrl` anymore (PR7 invariant)
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CANCEL_SRC = resolve(
  import.meta.dir,
  '../../src/cli/commands/bounty-task/cancel.ts',
);
const VALID_TASK_ID = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';

describe('bounty bounty-task cancel - PR7 ProfileContext integration', () => {
  let origFetch: typeof fetch;
  let origBountyApi: string | undefined;
  let origImAddress: string | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origBountyApi = process.env.BOUNTY_API_URL;
    origImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origBountyApi === undefined) {
      delete process.env.BOUNTY_API_URL;
    } else {
      process.env.BOUNTY_API_URL = origBountyApi;
    }
    if (origImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = origImAddress;
    }
  });

  test('T1 (static): cancel.ts uses resolveProfileApiBase helper', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-api-base.js'");
    expect(src).toMatch(/resolveProfileApiBase\(/);
  });

  test('T2 (static): cancel.ts reads ProfileContext.getActive()', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.getActive\(/);
  });

  test('T3 (static): cancel.ts does NOT read bountyConfig.apiUrl (PR7 invariant)', () => {
    const src = readFileSync(CANCEL_SRC, 'utf-8');
    expect(src).not.toMatch(/bountyConfig\.apiUrl/);
    expect(src).not.toContain("from '../../../lib/config/bounty-config.js'");
  });

  test('T4 (integration): profile.api_base is hit when no --server-url', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');

    ProfileContext.setActive({
      name: 'staging',
      api_base: 'http://127.0.0.1:41234',
      auth: { type: 'jwt', access_token: 'profile-tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: VALID_TASK_ID, status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const errSpy = mock(() => {});
    const origLog = console.log;
    const origErr = console.error;
    console.log = logSpy as any;
    console.error = errSpy as any;
    try {
      await cancelCommand.handler!({
        'task-id': VALID_TASK_ID,
        'publisher-address': '00000000-0000-4000-8000-000000000001@local',
      } as any);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:41234/')).toBe(true);
    expect(String(calledUrl)).toContain('/cancel');

    ProfileContext.clear();
  });

  test('T5 (integration): --server-url wins over profile.api_base', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');

    ProfileContext.setActive({
      name: 'staging',
      api_base: 'http://127.0.0.1:41234',
      auth: { type: 'jwt', access_token: 'profile-tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: VALID_TASK_ID, status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const errSpy = mock(() => {});
    const origLog = console.log;
    const origErr = console.error;
    console.log = logSpy as any;
    console.error = errSpy as any;
    try {
      await cancelCommand.handler!({
        'task-id': VALID_TASK_ID,
        'publisher-address': '00000000-0000-4000-8000-000000000001@local',
        'server-url': 'http://127.0.0.1:45555',
      } as any);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:45555/')).toBe(true);
    expect(String(calledUrl)).not.toContain('41234');

    ProfileContext.clear();
  });

  test('T6 (integration): when no profile and no --server-url, request goes to fallback API_BASE', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');

    ProfileContext.clear();
    delete process.env.BOUNTY_API_URL;

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: VALID_TASK_ID, status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const errSpy = mock(() => {});
    const origLog = console.log;
    const origErr = console.error;
    console.log = logSpy as any;
    console.error = errSpy as any;
    try {
      await cancelCommand.handler!({
        'task-id': VALID_TASK_ID,
        'publisher-address': '00000000-0000-4000-8000-000000000001@local',
      } as any);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://localhost:4000/')).toBe(true);
    expect(String(calledUrl)).not.toContain('41234');
  });

  test('T7 (integration): ProfileContext access_token is sent as Bearer', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { cancelCommand } = await import('../../src/cli/commands/bounty-task/cancel.js');

    ProfileContext.setActive({
      name: 'staging',
      api_base: 'http://127.0.0.1:41234',
      auth: {
        type: 'jwt',
        access_token: 'profile-bearer-token',
        refresh_token: 'r',
        expires_at: 0,
      },
      created_at: 0,
      updated_at: 0,
    });

    let calledAuthHeader: string | null = null;
    globalThis.fetch = mock(async (_url: any, init?: any) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const auth = (h['Authorization'] ?? h['authorization']) as string | undefined;
      calledAuthHeader = auth ?? null;
      return new Response(JSON.stringify({ id: VALID_TASK_ID, status: 'cancelled' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const errSpy = mock(() => {});
    const origLog = console.log;
    const origErr = console.error;
    console.log = logSpy as any;
    console.error = errSpy as any;
    try {
      await cancelCommand.handler!({
        'task-id': VALID_TASK_ID,
        'publisher-address': '00000000-0000-4000-8000-000000000001@local',
      } as any);
    } finally {
      console.log = origLog;
      console.error = origErr;
    }

    expect(calledAuthHeader).toBe('Bearer profile-bearer-token');

    ProfileContext.clear();
  });
});
