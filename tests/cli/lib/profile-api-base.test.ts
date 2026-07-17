import { describe, test, expect } from 'bun:test';
import { resolveProfileApiBase } from '../../../src/cli/lib/profile-api-base.js';

const stubResolver = (serverUrl: string | undefined, fallback: string): string => {
  if (!serverUrl) return fallback;
  if (!/^https?:\/\//.test(serverUrl)) {
    throw new Error('invalid scheme');
  }
  return serverUrl.replace(/\/+$/, '');
};

describe('resolveProfileApiBase', () => {
  test('returns profile.api_base when --server-url is omitted', () => {
    const base = resolveProfileApiBase({
      cliServerUrl: undefined,
      fallbackApiBase: 'http://localhost:4000',
      profile: { name: 'prod', api_base: 'https://bounty.example.com' },
      resolveServerUrlFn: stubResolver,
    });
    expect(base).toBe('https://bounty.example.com');
  });

  test('trims trailing slashes from profile.api_base', () => {
    const base = resolveProfileApiBase({
      cliServerUrl: undefined,
      fallbackApiBase: 'http://localhost:4000',
      profile: { name: 'local', api_base: 'http://localhost:4000///' },
      resolveServerUrlFn: stubResolver,
    });
    expect(base).toBe('http://localhost:4000');
  });

  test('prefers --server-url over profile.api_base', () => {
    const base = resolveProfileApiBase({
      cliServerUrl: 'https://override.example.com',
      fallbackApiBase: 'http://localhost:4000',
      profile: { name: 'prod', api_base: 'https://bounty.example.com' },
      resolveServerUrlFn: stubResolver,
    });
    expect(base).toBe('https://override.example.com');
  });

  test('falls back to fallbackApiBase when no profile and no --server-url', () => {
    const base = resolveProfileApiBase({
      cliServerUrl: undefined,
      fallbackApiBase: 'http://localhost:4000',
      profile: null,
      resolveServerUrlFn: stubResolver,
    });
    expect(base).toBe('http://localhost:4000');
  });

  test('delegates --server-url validation to the injected resolver', () => {
    expect(() =>
      resolveProfileApiBase({
        cliServerUrl: 'ftp://nope',
        fallbackApiBase: 'http://localhost:4000',
        profile: null,
        resolveServerUrlFn: stubResolver,
      }),
    ).toThrow(/invalid scheme/);
  });
});