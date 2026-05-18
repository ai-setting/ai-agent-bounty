/**
 * JWT Utilities Tests
 * 
 * Tests for createToken, verifyToken, and getTokenExpiry functions.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { createToken, verifyToken, getTokenExpiry } from '../../src/auth/jwt';

describe('JWT Utils', () => {
  const testSecret = 'test-jwt-secret-for-testing';
  const originalEnv = process.env;

  beforeEach(() => {
    // Set test JWT secret
    process.env = { ...originalEnv };
    process.env.JWT_SECRET = testSecret;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('createToken', () => {
    it('should create a valid JWT token with sub claim', async () => {
      const payload = { sub: 'agent-123' };
      
      const token = await createToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.').length).toBe(3); // JWT has 3 parts
    });

    it('should create a valid JWT token with sub and email claims', async () => {
      const payload = { sub: 'agent-456', email: 'test@example.com' };
      
      const token = await createToken(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should create different tokens for different payloads', async () => {
      const token1 = await createToken({ sub: 'agent-1' });
      const token2 = await createToken({ sub: 'agent-2' });
      
      expect(token1).not.toBe(token2);
    });

    it('should throw error when JWT_SECRET is not set', async () => {
      delete process.env.JWT_SECRET;
      
      await expect(createToken({ sub: 'agent-123' }))
        .rejects.toThrow('JWT_SECRET environment variable is required');
    });
  });

  describe('verifyToken', () => {
    it('should verify and decode a valid token', async () => {
      const payload = { sub: 'agent-789' };
      const token = await createToken(payload);
      
      const decoded = await verifyToken(token);
      
      expect(decoded.sub).toBe('agent-789');
    });

    it('should verify token with email claim', async () => {
      const payload = { sub: 'agent-email', email: 'test@example.com' };
      const token = await createToken(payload);
      
      const decoded = await verifyToken(token);
      
      expect(decoded.sub).toBe('agent-email');
      expect(decoded.email).toBe('test@example.com');
    });

    it('should include iat (issued at) claim', async () => {
      const token = await createToken({ sub: 'agent-iat' });
      
      const decoded = await verifyToken(token);
      
      expect(decoded.iat).toBeDefined();
      expect(typeof decoded.iat).toBe('number');
    });

    it('should include exp (expiration) claim', async () => {
      const token = await createToken({ sub: 'agent-exp' });
      
      const decoded = await verifyToken(token);
      
      expect(decoded.exp).toBeDefined();
      expect(typeof decoded.exp).toBe('number');
      expect(decoded.exp!).toBeGreaterThan(decoded.iat!);
    });

    it('should throw error for invalid token format', async () => {
      await expect(verifyToken('invalid-token'))
        .rejects.toThrow();
    });

    it('should throw error for tampered token', async () => {
      const token = await createToken({ sub: 'agent-tampered' });
      const tamperedToken = token.slice(0, -5) + 'xxxxx'; // Tamper with the signature
      
      await expect(verifyToken(tamperedToken))
        .rejects.toThrow();
    });

    it('should throw error for empty token', async () => {
      await expect(verifyToken(''))
        .rejects.toThrow();
    });

    it('should throw error for token signed with different secret', async () => {
      // Create token with one secret
      process.env.JWT_SECRET = 'secret-1';
      const token = await createToken({ sub: 'agent-secret' });
      
      // Verify with different secret
      process.env.JWT_SECRET = 'secret-2';
      
      await expect(verifyToken(token))
        .rejects.toThrow();
    });

    it('should throw error when JWT_SECRET is not set', async () => {
      delete process.env.JWT_SECRET;
      
      await expect(verifyToken('some-token'))
        .rejects.toThrow('JWT_SECRET environment variable is required');
    });
  });

  describe('getTokenExpiry', () => {
    it('should return 86400 seconds (24 hours)', () => {
      const expiry = getTokenExpiry();
      
      expect(expiry).toBe(24 * 60 * 60); // 86400
    });

    it('should return a positive number', () => {
      const expiry = getTokenExpiry();
      
      expect(expiry).toBeGreaterThan(0);
    });
  });

  describe('Token round-trip', () => {
    it('should correctly encode and decode agent payload', async () => {
      const originalPayload = {
        sub: 'agent-roundtrip',
        email: 'roundtrip@example.com'
      };
      
      const token = await createToken(originalPayload);
      const decoded = await verifyToken(token);
      
      expect(decoded.sub).toBe(originalPayload.sub);
      expect(decoded.email).toBe(originalPayload.email);
    });

    it('should preserve special characters in email', async () => {
      const payload = {
        sub: 'agent-special',
        email: 'user+tag@domain.co.uk'
      };
      
      const token = await createToken(payload);
      const decoded = await verifyToken(token);
      
      expect(decoded.email).toBe(payload.email);
    });
  });
});
