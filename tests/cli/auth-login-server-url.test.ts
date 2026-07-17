/**
 * Tests for `bounty auth login` CLI command — PR3 ProfileContext + api_base flow.
 *
 * PR3 design (replaces PR2 static-only tests):
 * - auth/login must use `resolveProfileApiBase` helper (introduced in PR3) so the
 *   api base resolves as: --server-url > active profile.api_base > API_BASE.
 * - auth/login must call `writeAuthToProfile` to persist access_token /
 *   refresh_token into the active profile.
 * - auth/login must not read BOUNTY_TOKEN env (PR1 invariant).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const LOGIN_SRC = resolve(import.meta.dir, '../../src/cli/commands/auth/login.ts');
const API_BASE_HELPER_SRC = resolve(import.meta.dir, '../../src/cli/lib/profile-api-base.ts');
const AUTH_WRITER_SRC = resolve(import.meta.dir, '../../src/cli/lib/profile-auth-writer.ts');

describe('bounty auth login - PR3 ProfileContext integration', () => {
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

  test('login.ts uses resolveProfileApiBase helper for fetch base', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-api-base.js'");
    expect(src).toMatch(/resolveProfileApiBase\(/);
  });

  test('login.ts reads ProfileContext for the active profile', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).toContain("from '../../config/context.js'");
    expect(src).toMatch(/ProfileContext\.getActive\(/);
  });

  test('login.ts delegates token persistence to writeAuthToProfile', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).toContain("from '../../lib/profile-auth-writer.js'");
    expect(src).toMatch(/writeAuthToProfile\(/);
  });

  test('login.ts does not read BOUNTY_TOKEN env (PR1 invariant)', () => {
    const src = readFileSync(LOGIN_SRC, 'utf-8');
    expect(src).not.toMatch(/BOUNTY_TOKEN/);
  });

  test('helper module exposes resolveProfileApiBase', () => {
    const src = readFileSync(API_BASE_HELPER_SRC, 'utf-8');
    expect(src).toContain('export function resolveProfileApiBase');
  });

  test('auth writer exposes writeAuthToProfile', () => {
    const src = readFileSync(AUTH_WRITER_SRC, 'utf-8');
    expect(src).toContain('export function writeAuthToProfile');
  });
});