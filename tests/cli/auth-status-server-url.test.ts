/**
 * Tests for `bounty auth status` CLI command — PR3 ProfileContext flow.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/auth/status.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty auth status - PR3 ProfileContext integration', () => {
  let origBountyToken: string | undefined;

  beforeEach(() => {
    origBountyToken = process.env.BOUNTY_TOKEN;
    delete process.env.BOUNTY_TOKEN;
  });

  afterEach(() => {
    if (origBountyToken === undefined) {
      delete process.env.BOUNTY_TOKEN;
    } else {
      process.env.BOUNTY_TOKEN = origBountyToken;
    }
  });

  test('status.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('status.ts uses resolveProfileApiBase for base URL', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-api-base.js'");
    expect(src).toMatch(/resolveProfileApiBase\(/);
  });

  test('status.ts reads ProfileContext for active profile + token', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.getActive\(/);
    expect(src).toContain("from '../../lib/auth-token.js'");
    expect(src).toMatch(/readAuthToken\(/);
  });

  test('status.ts fetch URL uses /api/agents/me', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/baseUrl.*\/api\/agents\/me/);
  });

  test('status.ts does not read BOUNTY_TOKEN env (PR1 invariant)', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/BOUNTY_TOKEN/);
  });
});

describe('bounty auth status - help output', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});