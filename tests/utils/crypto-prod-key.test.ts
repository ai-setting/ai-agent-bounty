/**
 * Tests for crypto key fallback behavior (C2)
 *
 * Background: Previously, getEncryptionKey() silently used a hardcoded
 * dev key when BOUNTY_ENCRYPTION_KEY was not set. This is a critical
 * security risk: if someone runs in production without setting the env
 * var, all encrypted data is decryptable by anyone with the source.
 *
 * New behavior:
 * - In dev (no NODE_ENV=production): fall back to dev key + console.warn
 * - In production (NODE_ENV=production): throw immediately
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { encrypt, decrypt } from '../../src/lib/utils/crypto';

describe('Crypto Key Fallback (C2)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should encrypt and decrypt in dev mode (fallback key allowed)', () => {
    delete process.env.BOUNTY_ENCRYPTION_KEY;
    delete process.env.NODE_ENV;

    const ct = encrypt('hello world');
    expect(ct).toBeTruthy();
    expect(decrypt(ct)).toBe('hello world');
  });

  it('should throw in production when BOUNTY_ENCRYPTION_KEY is not set', () => {
    delete process.env.BOUNTY_ENCRYPTION_KEY;
    process.env.NODE_ENV = 'production';

    try {
      expect(() => encrypt('secret')).toThrow(/BOUNTY_ENCRYPTION_KEY/);
    } finally {
      delete process.env.NODE_ENV;
    }
  });

  it('should still work in production when BOUNTY_ENCRYPTION_KEY is set', () => {
    process.env.BOUNTY_ENCRYPTION_KEY = 'a-secure-test-key';
    process.env.NODE_ENV = 'production';

    const ct = encrypt('secret-data');
    expect(decrypt(ct)).toBe('secret-data');
  });
});
