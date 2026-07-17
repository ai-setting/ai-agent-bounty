import { describe, test, expect, beforeEach } from 'bun:test';

describe('ProfileContext', () => {
  let ProfileContext: typeof import('../../../src/cli/config/context.js').ProfileContext;

  beforeEach(async () => {
    ProfileContext = (await import('../../../src/cli/config/context.js')).ProfileContext;
    ProfileContext.clear();
  });

  const profile = (withToken = true) => ({
    name: 'alice',
    api_base: 'https://bounty.example.com',
    auth: { type: 'jwt' as const, ...(withToken ? { access_token: 'ctx-token' } : {}) },
    created_at: 1,
    updated_at: 1,
  });

  test('getActive returns null initially', () => expect(ProfileContext.getActive()).toBeNull());

  test('setActive/getActive roundtrip', () => {
    ProfileContext.setActive(profile());
    expect(ProfileContext.getActive()?.name).toBe('alice');
  });

  test('clear resets state', () => {
    ProfileContext.setActive(profile());
    ProfileContext.clear();
    expect(ProfileContext.getActive()).toBeNull();
  });

  test('getAccessToken returns token from active profile', () => {
    ProfileContext.setActive(profile());
    expect(ProfileContext.getAccessToken()).toBe('ctx-token');
  });

  test('getAccessToken returns undefined without a token', () => {
    ProfileContext.setActive(profile(false));
    expect(ProfileContext.getAccessToken()).toBeUndefined();
  });

  test('getAccessToken returns undefined without active profile', () => {
    expect(ProfileContext.getAccessToken()).toBeUndefined();
  });

  test('getApiBase returns active profile API base', () => {
    ProfileContext.setActive(profile());
    expect(ProfileContext.getApiBase()).toBe('https://bounty.example.com');
  });

  test('getApiBase returns undefined without active profile (v0.13.1+ behavior)', () => {
    // v0.13.1 BREAKING: `getApiBase()` no longer throws when no profile is
    // active. Returns `undefined` so callers (com/*) can fall back to
    // --host/--port or --server-url without crashing on a hard throw.
    expect(ProfileContext.getApiBase()).toBeUndefined();
  });

  test('requireActiveProfile throws without active profile', () => {
    expect(() => ProfileContext.requireActiveProfile()).toThrow(/No active profile/);
  });

  test('requireActiveProfile returns active profile', () => {
    const current = profile();
    ProfileContext.setActive(current);
    expect(ProfileContext.requireActiveProfile()).toEqual(current);
  });
});
