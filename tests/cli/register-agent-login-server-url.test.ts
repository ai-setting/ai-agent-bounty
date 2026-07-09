/**
 * Tests for `bounty register-agent login` CLI command — --server-url option.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(import.meta.dir, '../../src/cli/commands/register-agent/login.ts');
const HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/server-url-option.ts');

describe('bounty register-agent login - --server-url option', () => {
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

  test('T1: register-agent login.ts references shared --server-url helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toContain("from '../../lib/server-url-option.js'");
    expect(src).toMatch(/addServerUrlOption\(/);
    expect(src).not.toMatch(/alias:\s*['"]u['"]/);
  });

  test('T2: register-agent login.ts uses resolveServerUrl with API_BASE fallback', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/resolveServerUrl\(.*API_BASE\s*\)/);
  });

  test('T3: fetch URL uses /api/auth/login', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).toMatch(/baseUrl.*\/api\/auth\/login/);
  });

  test('T4: scheme validation is delegated to helper', () => {
    const src = readFileSync(SRC, 'utf-8');
    expect(src).not.toMatch(/^https\?:\/\/\.test/);
    expect(src).toMatch(/resolveServerUrl/);
  });
});

describe('bounty register-agent login - help output', () => {
  test('shared helper declares --server-url / -u / description', () => {
    const helperSrc = readFileSync(HELPER_SRC, 'utf-8');
    expect(helperSrc).toContain("'server-url'");
    expect(helperSrc).toContain("alias: 'u'");
    expect(helperSrc).toMatch(/[Ss]ervice base URL/);
  });
});
