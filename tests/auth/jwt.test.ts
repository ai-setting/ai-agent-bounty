import { describe, it, expect, beforeEach } from 'bun:test';
import { createToken, verifyToken, getTokenExpiry } from '../../src/auth/jwt.js';

describe('JWT Utilities', () => {
  beforeEach(() => {
    // Set test secret
    process.env.JWT_SECRET = 'test-secret-key';
  });

  describe('createToken', () => {
    it('should create a valid JWT with 3 parts separated by dots', async () => {
      const token = await createToken({
        sub: 'agent-123',
        email: 'test@example.com',
      });

      const parts = token.split('.');
      expect(parts.length).toBe(3);
    });

    it('should include sub and email in payload', async () => {
      const token = await createToken({
        sub: 'agent-456',
        email: 'agent@example.com',
      });

      const { payload } = await import('jose').then(jose => 
        jose.jwtVerify(token, new TextEncoder().encode('test-secret-key'))
      );

      expect(payload.sub).toBe('agent-456');
      expect(payload.email).toBe('agent@example.com');
    });

    it('should set issued at timestamp', async () => {
      const token = await createToken({
        sub: 'agent-789',
        email: 'test@test.com',
      });

      const { payload } = await import('jose').then(jose => 
        jose.jwtVerify(token, new TextEncoder().encode('test-secret-key'))
      );

      expect(payload.iat).toBeDefined();
      expect(typeof payload.iat).toBe('number');
    });

    it('should set expiration to 24 hours', async () => {
      const token = await createToken({
        sub: 'agent-exp',
        email: 'exp@test.com',
      });

      const { payload } = await import('jose').then(jose => 
        jose.jwtVerify(token, new TextEncoder().encode('test-secret-key'))
      );

      // exp should be ~24 hours after iat
      const expectedExp = (payload.iat as number) + 24 * 60 * 60;
      expect(payload.exp).toBe(expectedExp);
    });
  });

  describe('verifyToken', () => {
    it('should return correct payload for valid token', async () => {
      const token = await createToken({
        sub: 'agent-verify',
        email: 'verify@example.com',
      });

      const payload = await verifyToken(token);

      expect(payload.sub).toBe('agent-verify');
      expect(payload.email).toBe('verify@example.com');
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });

    it('should throw for invalid token', async () => {
      const invalidToken = 'invalid.token.here';

      await expect(verifyToken(invalidToken)).rejects.toThrow();
    });

    it('should throw for invalid signature', async () => {
      const token = await createToken({
        sub: 'agent-sig',
        email: 'sig@example.com',
      });

      // Tamper with signature
      const parts = token.split('.');
      parts[2] = 'invalid_signature';
      const tamperedToken = parts.join('.');

      await expect(verifyToken(tamperedToken)).rejects.toThrow();
    });
  });

  describe('getTokenExpiry', () => {
    it('should return 86400 (24 hours in seconds)', () => {
      const expiry = getTokenExpiry();
      expect(expiry).toBe(86400);
    });
  });

  describe('error handling', () => {
    it('should throw error when JWT_SECRET is missing', async () => {
      // Save original value
      const originalSecret = process.env.JWT_SECRET;
      
      // Remove JWT_SECRET
      delete process.env.JWT_SECRET;

      // Create token should throw
      await expect(createToken({
        sub: 'agent-error',
        email: 'error@example.com',
      })).rejects.toThrow('JWT_SECRET environment variable is required');

      // Restore
      process.env.JWT_SECRET = originalSecret;
    });
  });
});
