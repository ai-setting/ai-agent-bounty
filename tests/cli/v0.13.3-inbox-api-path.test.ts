/**
 * v0.13.3: Tests for `bounty com inbox` CLI command — URL must include /api prefix.
 *
 * Background (pre-existing bug since v0.13.0):
 *   `com/inbox.ts` constructed the URL as
 *     `${baseUrl}/messages?email=...`
 *   When `baseUrl` resolves to the production hostname (e.g.
 *   https://bounty.tongagents.example.com via profile.api_base or
 *   --server-url), the k8s nginx ingress routes /messages to the SPA
 *   HTML fallback, returning 200 OK with text/html body. The CLI then
 *   failed with "Failed to parse JSON".
 *
 *   Compare to `com/send.ts` which already uses `${trimmed}/api/messages`.
 *
 * v0.13.3 expected behaviour:
 *   T1: `bounty com inbox --email X` (with profile.api_base / --server-url)
 *       must hit `/api/messages?email=...` — not `/messages?...`.
 *   T2: legacy `--host/--port` fallback also uses `/api/messages`
 *       (unified path with the new /api convention).
 *   T3 (regression guard): `com/send.ts` source still uses `/api/messages`
 *       for both profile.api_base and --server-url branches. Prevents
 *       send.ts from regressing to `/messages`.
 *
 * Note: T2 verifies the unified path used in this fix; we keep send.ts
 * legacy `/messages` (line ~177) untouched in v0.13.3 to minimise blast
 * radius — the user explicitly opted for a conservative fix here.
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INBOX_SRC = resolve(
  import.meta.dir,
  '../../src/cli/commands/com/inbox.ts'
);
const SEND_SRC = resolve(
  import.meta.dir,
  '../../src/cli/commands/com/send.ts'
);

// ============================================================================
// T1: profile.api_base branch hits /api/messages
// ============================================================================
describe('bounty com inbox — /api path (v0.13.3 fix)', () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  test('T1: profile.api_base branch hits /api/messages?email=... (not /messages?)', async () => {
    const { ProfileContext } = await import(
      '../../src/cli/config/context.js'
    );
    const { inboxCommand } = await import(
      '../../src/cli/commands/com/inbox.js'
    );

    ProfileContext.setActive({
      name: 'v0.13.3-inbox-api-test',
      api_base: 'http://127.0.0.1:42310',
      auth: {
        type: 'jwt',
        access_token: 'tok',
        refresh_token: 'r',
        expires_at: 0,
      },
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
    expect(String(calledUrl)).toMatch(
      /^http:\/\/127\.0\.0\.1:42310\/api\/messages\?email=/
    );
    // Negative: URL must NOT start with `<host>/messages?` (the buggy
    // pre-v0.13.3 path that k8s ingress routes to SPA HTML fallback).
    expect(String(calledUrl)).not.toMatch(
      /^http:\/\/127\.0\.0\.1:42310\/messages\?/
    );
  });

  // ============================================================================
  // T2: legacy --host/--port fallback also uses /api/messages
  // ============================================================================
  test('T2: legacy --host/--port fallback also uses /api/messages (unified)', async () => {
    const { ProfileContext } = await import(
      '../../src/cli/config/context.js'
    );
    const { inboxCommand } = await import(
      '../../src/cli/commands/com/inbox.js'
    );

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
    // v0.13.3: legacy fallback also uses /api/messages
    expect(String(calledUrl)).toMatch(
      /^http:\/\/fallback\.example\.com:4998\/api\/messages\?email=/
    );
  });

  // ============================================================================
  // T3: send.ts regression guard — both branches still use /api/messages
  // ============================================================================
  test('T3 (regression guard): send.ts still uses /api/messages for profile.api_base and --server-url', () => {
    const src = readFileSync(SEND_SRC, 'utf-8');
    // --server-url branch
    expect(src).toContain("`${trimmed}/api/messages`");
    // profile.api_base branch
    expect(src).toMatch(/profile\.api_base[\s\S]*?\/api\/messages/);
  });
});

// ============================================================================
// Source-level sanity check: inbox.ts source uses /api/messages (not /messages)
// ============================================================================
describe('bounty com inbox — source-level /api wiring (v0.13.3)', () => {
  test('inbox.ts source constructs ${baseUrl}/api/messages?email=...', () => {
    const src = readFileSync(INBOX_SRC, 'utf-8');
    expect(src).toMatch(
      /\$\{baseUrl\}\/api\/messages\?email=\$\{encodeURIComponent\(identifier\)\}/
    );
    // Negative assertion: the buggy old path must NOT be present.
    expect(src).not.toMatch(
      /\$\{baseUrl\}\/messages\?email=\$\{encodeURIComponent\(identifier\)\}/
    );
  });
});