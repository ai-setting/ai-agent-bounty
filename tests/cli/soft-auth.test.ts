import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('soft auth helper', () => {
  let dir: string;
  let tokenPath: string;

  beforeEach(() => {
    dir = join(tmpdir(), `bounty-soft-auth-${Date.now()}-${Math.random()}`);
    mkdirSync(dir, { recursive: true });
    tokenPath = join(dir, 'token');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test('attaches Authorization header when token exists', async () => {
    const { attachSoftAuth } = await import('../../src/cli/lib/soft-auth.js');
    writeFileSync(tokenPath, '  jwt-token-123  ', 'utf-8');

    const result = attachSoftAuth({ Accept: 'application/json' }, tokenPath);

    expect(result.hasToken).toBe(true);
    expect(result.headers.Accept).toBe('application/json');
    expect(result.headers.Authorization).toBe('Bearer jwt-token-123');
  });

  test('does not throw or attach Authorization when token file is missing', async () => {
    const { attachSoftAuth } = await import('../../src/cli/lib/soft-auth.js');

    const result = attachSoftAuth({ Accept: 'application/json' }, tokenPath);

    expect(result.hasToken).toBe(false);
    expect(result.headers.Accept).toBe('application/json');
    expect(result.headers.Authorization).toBeUndefined();
  });

  test('does not attach Authorization for empty token file', async () => {
    const { attachSoftAuth } = await import('../../src/cli/lib/soft-auth.js');
    writeFileSync(tokenPath, '   \n', 'utf-8');

    const result = attachSoftAuth({}, tokenPath);

    expect(result.hasToken).toBe(false);
    expect(result.headers.Authorization).toBeUndefined();
  });

  test('does not mutate the caller headers object', async () => {
    const { attachSoftAuth } = await import('../../src/cli/lib/soft-auth.js');
    writeFileSync(tokenPath, 'jwt-token-123', 'utf-8');
    const headers: Record<string, string> = { Accept: 'application/json' };

    const result = attachSoftAuth(headers, tokenPath);

    expect(headers.Authorization).toBeUndefined();
    expect(result.headers.Authorization).toBe('Bearer jwt-token-123');
  });
});
