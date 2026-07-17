/**
 * Tests for `bounty register-agent get` CLI command — --server-url option (v0.14).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/get.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty register-agent get - --server-url option (v0.14 email-only)', () => {
  let origApiUrl: string | undefined;

  beforeEach(() => {
    origApiUrl = process.env.BOUNTY_API_URL;
    delete process.env.BOUNTY_API_URL;
  });

  afterEach(() => {
    if (origApiUrl === undefined) {
      delete process.env.BOUNTY_API_URL;
    } else {
      process.env.BOUNTY_API_URL = origApiUrl;
    }
  });

  test('T1: get.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('T2: get.ts uses resolveServerUrl with API_BASE fallback', () => {
    const src = readFileSync(SRC, 'utf-8');
    // multi-line: `resolveServerUrl(\n  argv['server-url'],\n  API_BASE,\n)`
    expect(src).toMatch(/resolveServerUrl\([\s\S]*?API_BASE/);
  });

  test('T3: fetch URL uses /api/agents/by-email?email=<email> (v0.14: no legacy uuid path)', () => {
    const src = readFileSync(SRC, 'utf-8');
    // v0.14: lookup exclusively via by-email; legacy /api/agents/${uuid} REMOVED.
    expect(src).toMatch(/api\/agents\/by-email\?email/);
    expect(src).not.toMatch(/api\/agents\/\$\{agentUuid\}/);
  });

  test('T4: scheme validation is delegated to helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/^https\?:\/\/\.test/);
    expect(src).toMatch(/resolveServerUrl/);
  });
});

describe('bounty register-agent get - help output', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});
