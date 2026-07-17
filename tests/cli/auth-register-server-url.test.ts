/**
 * Tests for `bounty auth register` CLI command — PR3 ProfileContext flow.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/auth/register.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty auth register - PR3 ProfileContext integration', () => {
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

  test('register.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('register.ts uses resolveProfileApiBase for base URL', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-api-base.js'");
    expect(src).toMatch(/resolveProfileApiBase\(/);
  });

  test('register.ts reads ProfileContext for active profile', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.getActive\(/);
  });

  test('fetch URL uses /api/auth/register', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/baseUrl.*\/api\/auth\/register/);
  });

  test('register.ts does not read BOUNTY_TOKEN env (PR1 invariant)', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/BOUNTY_TOKEN/);
  });
});

describe('bounty auth register - help output reflects --server-url', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});