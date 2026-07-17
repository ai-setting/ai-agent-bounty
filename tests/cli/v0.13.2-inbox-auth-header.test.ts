/**
 * v0.13.2: Tests for `bounty com inbox` CLI command — Authorization header.
 *
 * Background (v0.13.1 bug):
 *   `com inbox.ts` called `bountyFetch(url)` without any Authorization
 *   header. With v0.13's default-on token check, the server returned 401
 *   and `bounty com inbox --email X` could not read the inbox. Compare
 *   to `com send` which already attaches the Bearer header via
 *   `readAuthToken()`.
 *
 * v0.13.2 expected behaviour:
 *   T5: `bounty com inbox --email X` attaches `Authorization: Bearer <token>`
 *       when an active profile (or token file) provides a JWT.
 *   T6: With no token (no profile, no file), inbox still works (no error
 *       thrown) — same fallback behaviour as `com send`.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const INBOX_SRC = resolve(import.meta.dir, '../../src/cli/commands/com/inbox.ts');

describe('bounty com inbox — Authorization header (v0.13.2 fix)', () => {
  let capturedRequests: Array<{
    url: string;
    headers: Record<string, string>;
  }> = [];
  let mockServer: ReturnType<typeof Bun.serve> | null = null;
  let baseUrl: string;

  beforeEach(async () => {
    capturedRequests = [];
    mockServer = Bun.serve({
      port: 0,
      fetch(req) {
        capturedRequests.push({
          url: req.url,
          headers: Object.fromEntries(req.headers.entries()),
        });
        // Return empty inbox so the command exits normally.
        return Response.json([]);
      },
    });
    baseUrl = `http://localhost:${mockServer.port}`;

    // Clear ProfileContext before each test so token resolution starts from
    // a known state.
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    ProfileContext.clear();
  });

  afterEach(async () => {
    if (mockServer) {
      await mockServer.stop();
      mockServer = null;
    }
  });

  // ==== T5: Authorization header attached when token exists ====
  test('T5: inbox --email attaches Authorization: Bearer <token> when profile has access_token', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    ProfileContext.setActive({
      name: 'v0.13.2-inbox-test',
      api_base: baseUrl,
      auth: { type: 'jwt', access_token: 'jwt-from-profile-v0132' },
      created_at: 0,
      updated_at: 0,
    });

    const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');
    await inboxCommand.handler({
      email: 'alice@example.com',
      host: 'localhost',
      port: 0,
      limit: 10,
      'server-url': baseUrl,
    } as any);

    expect(capturedRequests.length).toBe(1);
    expect(capturedRequests[0]!.headers['authorization']).toBe(
      'Bearer jwt-from-profile-v0132'
    );
  });

  // ==== T6: no token path → still works ====
  // Note: We can't easily simulate "no token" without touching the user's
  // real ~/.config/bounty/token file (readAuthToken's fallback to disk
  // file is exercised regardless). The contract we're asserting here is
  // narrower than the original spec: when fetch returns 200 (mock OK),
  // the inbox handler must NOT throw or exit(1). The "fallback to no
  // header" half is covered by auth-token-read.test.ts at the unit level.
  test('T6: inbox --email completes cleanly when fetch returns 200', async () => {
    const { ProfileContext } = await import('../../src/cli/config/context.js');
    ProfileContext.clear();

    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
      // throw to short-circuit; we still assert on captured exitCode below.
      throw new Error(`process.exit called with ${code}`);
    }) as any;

    let handlerErr: unknown;
    try {
      const { inboxCommand } = await import('../../src/cli/commands/com/inbox.js');
      await inboxCommand.handler({
        email: 'alice@example.com',
        host: 'localhost',
        port: 0,
        limit: 10,
        'server-url': baseUrl,
      } as any);
    } catch (e) {
      handlerErr = e;
    } finally {
      process.exit = origExit;
    }

    // handler completed without throwing; no process.exit(1) was triggered
    // by the "Failed to get inbox" branch.
    expect(handlerErr).toBeUndefined();
    expect(exitCode).toBeUndefined();
    expect(capturedRequests.length).toBe(1);
  });
});

describe('bounty com inbox — source wiring (v0.13.2)', () => {
  test('inbox.ts source declares readAuthToken + Authorization header wiring', () => {
    // Source-level sanity check: even if the runtime test above is in a
    // separate bun runtime, the wiring must be present in the source so
    // reviewers can see it.
    const src = readFileSync(INBOX_SRC, 'utf-8');
    expect(src).toContain('readAuthToken');
    expect(src).toContain('Authorization');
    expect(src).toContain('Bearer ${authToken}');
  });
});