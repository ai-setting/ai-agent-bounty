/**
 * Tests for JWT secret fallback behavior (C1)
 *
 * Background: Previously, getSecret() would throw immediately if
 * JWT_SECRET is not set. This makes development friction (every
 * developer must set JWT_SECRET) and breaks the imap-poll demo.
 *
 * New behavior: When JWT_SECRET is not set, the module should
 * automatically fall back to a stable derived secret (based on
 * hostname+pid) and log a warning. The token should still verify.
 *
 * Important: Throwing behavior is preserved when an explicit empty
 * string is forced in production (NODE_ENV=production).
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createToken, verifyToken } from '../../src/auth/jwt';

describe('JWT Secret Fallback (C1)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should create and verify a token when JWT_SECRET is not set (dev fallback)', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;

    const token = await createToken({ sub: 'agent-fallback-1' });
    expect(token).toBeDefined();
    expect(token.split('.').length).toBe(3);

    const decoded = await verifyToken(token);
    expect(decoded.sub).toBe('agent-fallback-1');
  });

  it('should produce verifiable tokens across multiple calls in same process (stable fallback)', async () => {
    delete process.env.JWT_SECRET;
    delete process.env.NODE_ENV;

    const t1 = await createToken({ sub: 'a' });
    const t2 = await createToken({ sub: 'b' });

    expect((await verifyToken(t1)).sub).toBe('a');
    expect((await verifyToken(t2)).sub).toBe('b');
  });

  it('should still prefer explicit JWT_SECRET when set', async () => {
    process.env.JWT_SECRET = 'explicit-test-secret';
    delete process.env.NODE_ENV;

    const token = await createToken({ sub: 'agent-explicit' });
    const decoded = await verifyToken(token);
    expect(decoded.sub).toBe('agent-explicit');
  });

  it('should throw in production when JWT_SECRET is not set', async () => {
    delete process.env.JWT_SECRET;
    process.env.NODE_ENV = 'production';

    try {
      await expect(createToken({ sub: 'agent-prod' })).rejects.toThrow(/JWT_SECRET/);
    } finally {
      delete process.env.NODE_ENV;
    }
  });
});
