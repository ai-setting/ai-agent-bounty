/**
 * Tests for `bounty com {send,inbox,connect,disconnect}` reading profile.api_base
 * when --server-url is absent (v0.13.1 bug fix).
 *
 * v0.13.0 regression: com/* commands ignored the active profile's api_base and
 * fell back to `http://${host}:${port}`, so users had to manually pass
 * --server-url even when an active profile had a working api_base. This was
 * inconsistent with auth/*, register-agent/*, bounty-task/* commands.
 *
 * v0.13.1 fix: com/* commands must read profile.api_base when --server-url is
 * absent. Priority order:
 *   --server-url > profile.api_base > http://${host}:${port}
 *
 * For each command we test:
 *  T_static: source code wires up ProfileContext and/or resolveProfileApiBase
 *  T_integration_profile: with active profile + no --server-url → fetch hits profile.api_base
 *  T_integration_server_url: --server-url wins over profile.api_base
 *  T_integration_fallback: no profile + no --server-url → falls back to host:port
 *
 * connect.ts uses a WebSocket probe (not HTTP fetch), so we test it by mocking
 * the WebSocket constructor rather than globalThis.fetch.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SEND_SRC = resolve(import.meta.dir, '../../src/cli/commands/com/send.ts');
const INBOX_SRC = resolve(import.meta.dir, '../../src/cli/commands/com/inbox.ts');
const CONNECT_SRC = resolve(import.meta.dir, '../../src/cli/commands/com/connect.ts');
const DISCONNECT_SRC = resolve(import.meta.dir, '../../src/cli/commands/com/disconnect.ts');

// ----------------------------------------------------------------------------
// send.ts
// ----------------------------------------------------------------------------
describe('bounty com send - profile.api_base wiring (v0.13.1)', () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('S1 (static): send.ts imports ProfileContext from config/context.js', () => {
    const src = readFileSync(SEND_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
  });

  test('S2 (static): send.ts source falls back to profile.api_base when --server-url absent', () => {
    const src = readFileSync(SEND_SRC, 'utf-8');
    // 必须有：profile.api_base 分支
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
    // 必须仍然保留 host/port fallback（向后兼容）
    expect(src).toContain('`http://${host}:${port}/messages`');
    // --server-url 仍然优先
    expect(src).toContain("`${trimmed}/api/messages`");
  });

  test('S3 (integration): profile.api_base is hit when no --server-url', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { sendCommand } = await import('../../src/cli/commands/com/send.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42301',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: 'm1', from: 'a', to: 'b' }), {
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
      // sendCommand.handler expects yargs-shaped args.
      await sendCommand.handler!({
        fromEmail: 'a@example.com',
        toEmail: 'b@example.com',
        body: 'hi',
        // NO --server-url; profile should win.
      } as any);
    } finally {
      console.log = origLog;
      console.error = origErr;
      ProfileContext.clear();
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:42301/')).toBe(true);
    // IM API path: must be /api/messages for profile branch (consistent with --server-url).
    expect(String(calledUrl)).toMatch(/\/api\/messages$/);
    // Must NOT have hit the legacy localhost fallback.
    expect(String(calledUrl)).not.toContain('localhost:4000');
  });

  test('S4 (integration): --server-url wins over profile.api_base', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { sendCommand } = await import('../../src/cli/commands/com/send.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42301',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: 'm1', from: 'a', to: 'b' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await sendCommand.handler!({
        fromEmail: 'a@example.com',
        toEmail: 'b@example.com',
        body: 'hi',
        serverUrl: 'http://127.0.0.1:45555',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:45555/')).toBe(true);
    expect(String(calledUrl)).not.toContain('42301');
    expect(String(calledUrl)).toMatch(/\/api\/messages$/);
  });

  test('S5 (integration): when no profile and no --server-url, request falls back to host:port', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { sendCommand } = await import('../../src/cli/commands/com/send.js');

    ProfileContext.clear();

    let calledUrl: string | null = null;
    globalThis.fetch = mock(async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({ id: 'm1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await sendCommand.handler!({
        fromEmail: 'a@example.com',
        toEmail: 'b@example.com',
        body: 'hi',
        host: 'fallback.example.com',
        port: 4999,
      } as any);
    } finally {
      console.log = origLog;
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl)).toBe('http://fallback.example.com:4999/messages');
  });
});

// ----------------------------------------------------------------------------
// inbox.ts
// ----------------------------------------------------------------------------
describe('bounty com inbox - profile.api_base wiring (v0.13.1)', () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('I1 (static): inbox.ts imports ProfileContext', () => {
    const src = readFileSync(INBOX_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
  });

  test('I2 (static): inbox.ts source falls back to profile.api_base when --server-url absent', () => {
    const src = readFileSync(INBOX_SRC, 'utf-8');
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
    // The resolveProfileApiBase helper OR inline profile.api_base check must exist.
    expect(src).toMatch(/resolveProfileApiBase\(|profile\.api_base/);
  });

  test('I3 (integration): profile.api_base is hit when no --server-url', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42302',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
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
      await inboxCommand.handler!({
        email: 'dongzhaokun@bigai.ai',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:42302/')).toBe(true);
    expect(String(calledUrl)).toContain('/messages');
    expect(String(calledUrl)).not.toContain('localhost:4000');
  });

  test('I4 (integration): --server-url wins over profile.api_base', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42302',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
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
      await inboxCommand.handler!({
        email: 'dongzhaokun@bigai.ai',
        'server-url': 'http://127.0.0.1:45556',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    expect(calledUrl).not.toBeNull();
    expect(String(calledUrl).startsWith('http://127.0.0.1:45556/')).toBe(true);
    expect(String(calledUrl)).not.toContain('42302');
  });

  test('I5 (integration): when no profile and no --server-url, falls back to host:port', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');

    ProfileContext.clear();

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
      await inboxCommand.handler!({
        email: 'a@example.com',
        host: 'fallback.example.com',
        port: 4998,
      } as any);
    } finally {
      console.log = origLog;
    }

    expect(calledUrl).not.toBeNull();
    // v0.13.3: legacy fallback now also uses /api/messages (was /messages
    // pre-v0.13.3 — the k8s-ingress + production-hostname path now needs
    // /api). See tests/cli/v0.13.3-inbox-api-path.test.ts for the bug fix.
    expect(String(calledUrl).startsWith('http://fallback.example.com:4998/api/messages')).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// connect.ts (WebSocket probe)
// ----------------------------------------------------------------------------
describe('bounty com connect - profile.api_base wiring (v0.13.1)', () => {
  let origWebSocket: any;

  beforeEach(() => {
    origWebSocket = (globalThis as any).WebSocket;
  });

  afterEach(() => {
    (globalThis as any).WebSocket = origWebSocket;
  });

  test('C1 (static): connect.ts imports ProfileContext', () => {
    const src = readFileSync(CONNECT_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
  });

  test('C2 (static): connect.ts uses profile.api_base for ws URL when --server-url absent', () => {
    const src = readFileSync(CONNECT_SRC, 'utf-8');
    expect(src).toMatch(/ProfileContext\.(getApiBase|getActive)/);
    // must still build ws:// from http base via scheme swap
    expect(src).toMatch(/replace\(/);
    expect(src).toMatch(/\^http/);
    expect(src).toContain("'ws'");
  });

  test('C3 (integration): ws probe uses profile.api_base when no --server-url', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { connectCommand } = await import('../../src/cli/commands/com/connect.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42303',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let wsUrlCalled: string | null = null;
    class FakeWS {
      url: string;
      onopen: ((ev?: any) => void) | null = null;
      onerror: ((ev?: any) => void) | null = null;
      onclose: ((ev?: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        wsUrlCalled = url;
        // Fire onopen on next tick so the handler's Promise resolves.
        setImmediate(() => {
          if (this.onopen) this.onopen();
        });
      }
      close() {}
    }
    (globalThis as any).WebSocket = FakeWS as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await connectCommand.handler!({
        email: 'dongzhaokun@bigai.ai',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    expect(wsUrlCalled).not.toBeNull();
    // http://127.0.0.1:42303 → ws://127.0.0.1:42303/ws?email=...
    expect(String(wsUrlCalled).startsWith('ws://127.0.0.1:42303/ws')).toBe(true);
    expect(String(wsUrlCalled)).toContain('email=dongzhaokun%40bigai.ai');
    expect(String(wsUrlCalled)).not.toContain('localhost:4000');
  });

  test('C4 (integration): --server-url wins over profile.api_base for ws probe', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { connectCommand } = await import('../../src/cli/commands/com/connect.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42303',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    let wsUrlCalled: string | null = null;
    class FakeWS {
      url: string;
      onopen: ((ev?: any) => void) | null = null;
      onerror: ((ev?: any) => void) | null = null;
      onclose: ((ev?: any) => void) | null = null;
      constructor(url: string) {
        this.url = url;
        wsUrlCalled = url;
        // Fire onopen on next tick so the handler's Promise resolves.
        setImmediate(() => {
          if (this.onopen) this.onopen();
        });
      }
      close() {}
    }
    (globalThis as any).WebSocket = FakeWS as any;

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await connectCommand.handler!({
        email: 'dongzhaokun@bigai.ai',
        'server-url': 'http://127.0.0.1:45557',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    expect(wsUrlCalled).not.toBeNull();
    expect(String(wsUrlCalled).startsWith('ws://127.0.0.1:45557/ws')).toBe(true);
    expect(String(wsUrlCalled)).not.toContain('42303');
  });
});

// ----------------------------------------------------------------------------
// disconnect.ts (no network call — test for source-level wiring)
// ----------------------------------------------------------------------------
describe('bounty com disconnect - profile context awareness (v0.13.1)', () => {
  test('D1 (static): disconnect.ts does not bypass ProfileContext (no --server-url hardcoded)', () => {
    const src = readFileSync(DISCONNECT_SRC, 'utf-8');
    // disconnect is a no-op stub today, but it must NOT actively hardcode
    // a server URL or bypass profile awareness. The v0.13.1 contract is
    // that disconnect is profile-aware via shared --profile flag (PR1)
    // and does not need its own --server-url.
    expect(src).not.toContain("'server-url'");
    expect(src).not.toContain('host:');
    expect(src).not.toContain('localhost:4000');
  });

  test('D2 (integration): disconnect handler runs without error even when profile is active', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    const { disconnectCommand } = await import('../../src/cli/commands/com/disconnect.js');

    ProfileContext.setActive({
      name: 'prod',
      api_base: 'http://127.0.0.1:42303',
      auth: { type: 'jwt', access_token: 'tok', refresh_token: 'r', expires_at: 0 },
      created_at: 0,
      updated_at: 0,
    });

    const logSpy = mock(() => {});
    const origLog = console.log;
    console.log = logSpy as any;
    try {
      await disconnectCommand.handler!({
        email: 'dongzhaokun@bigai.ai',
      } as any);
    } finally {
      console.log = origLog;
      ProfileContext.clear();
    }

    // No assertion on log content; just confirm no throw.
    expect(logSpy).toHaveBeenCalled();
  });
});