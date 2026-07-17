/**
 * Tests for `bounty bounty-task board` CLI command — PR7 ProfileContext wiring.
 *
 * PR7 design (mirrors PR3 auth/* behavior):
 * - board command must use `resolveProfileApiBase` helper so the
 *   api base resolves as: --server-url > active profile.api_base > API_BASE.
 * - board command must read `ProfileContext.getActive()` to consult the
 *   active profile's api_base.
 * - board command must NOT read `bountyConfig.apiUrl` anymore
 *   (PR7 invariant — old fall-through removed).
 * - Token path: kept unchanged because `bountyHttp()` already calls
 *   `readAuthToken()` which prefers `ProfileContext.getAccessToken()` (PR1).
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const BOARD_SRC = resolve(
  import.meta.dir,
  '../../src/cli/commands/bounty-task/board.ts',
);

describe('bounty bounty-task board - PR7 ProfileContext integration', () => {
  let origFetch: typeof fetch;
  let origBountyApi: string | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origBountyApi = process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_API_URL;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origBountyApi === undefined) {
      delete process.env.BOUNTY_API_URL;
    } else {
      process.env.BOUNTY_API_URL = origBountyApi;
    }
  });

  test('T1 (static): board.ts uses resolveProfileApiBase helper', () => {
    const src = readFileSync(BOARD_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-api-base.js'");
    expect(src).toMatch(/resolveProfileApiBase\(/);
  });

  test('T2 (static): board.ts reads ProfileContext.getActive()', () => {
    const src = readFileSync(BOARD_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.getActive\(/);
  });

  test('T3 (static): board.ts does NOT read bountyConfig.apiUrl (PR7 invariant)', () => {
    const src = readFileSync(BOARD_SRC, 'utf-8');
    // PR7 invariant: the old pattern `bountyConfig.apiUrl` must be removed.
    expect(src).not.toMatch(/bountyConfig\.apiUrl/);
    // PR7 invariant: bountyConfig import from the old path is also gone.
    expect(src).not.toContain("from '../../../lib/config/bounty-config.js'");
  });

  test('T4 (integration): profile.api_base is hit when no --server-url', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');

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
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    // Suppress console.log inside handler
    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await boardCommand.handler!({} as any);
    } finally {
      console.log = origLog;
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:41234/api/tasks')).toBe(true);

    ProfileContext.clear();
  });

  test('T5 (integration): --server-url wins over profile.api_base', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');

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
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await boardCommand.handler!({ 'server-url': 'http://127.0.0.1:45555' } as any);
    } finally {
      console.log = origLog;
    }

    expect(calledUrl).not.toBeNull();
    // --server-url wins: profile's port (41234) should NOT appear.
    expect(String(calledUrl).startsWith('http://127.0.0.1:45555/')).toBe(true);
    expect(String(calledUrl)).not.toContain('41234');

    ProfileContext.clear();
  });

  test('T6 (integration): when no profile and no --server-url, request goes to fallback API_BASE', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');

    ProfileContext.clear();
    // API_BASE is resolved at module init time (`bounty-config.ts` const).
    // No profile, no --server-url, no BOUNTY_API_URL → request must go to
    // the documented default `http://localhost:4000`.
    delete process.env.BOUNTY_API_URL;

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await boardCommand.handler!({} as any);
    } finally {
      console.log = origLog;
    }

    expect(calledUrl).not.toBeNull();
    // Must hit localhost:4000 (the API_BASE default / a value derived from
    // BOUNTY_API_URL captured at module init), NOT the profile mock port.
    expect(String(calledUrl).startsWith('http://localhost:4000/api/tasks')).toBe(true);
    expect(String(calledUrl)).not.toContain('41234');
  });

  test('T7 (integration): ProfileContext access_token is sent as Bearer when handler runs', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { boardCommand } = await import('../../src/cli/commands/bounty-task/board.js');

    ProfileContext.setActive({
      name: 'staging',
      api_base: 'http://127.0.0.1:41234',
      auth: { type: 'jwt', access_token: 'profile-bearer-token', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let calledAuthHeader: string | null = null;
    globalThis.fetch = mock(async (_url: any, init?: any) => {
      const h = (init?.headers ?? {}) as Record<string, string>;
      const auth = (h['Authorization'] ?? h['authorization']) as string | undefined;
      calledAuthHeader = auth ?? null;
      return new Response(JSON.stringify([]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await boardCommand.handler!({} as any);
    } finally {
      console.log = origLog;
    }

    expect(calledAuthHeader).toBe('Bearer profile-bearer-token');

    ProfileContext.clear();
  });
});
