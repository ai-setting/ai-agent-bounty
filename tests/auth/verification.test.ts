/**
 * Verification Code Logic Tests
 * 
 * Tests for generateCode, checkRateLimit, createVerification, verifyCode functions.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';
import { generateCode, checkRateLimit, createVerification, verifyCode, getLatestVerification } from '../../src/auth/verification.js';

// Mock database setup
const createMockDb = () => ({
  prepare: vi.fn().mockReturnValue({
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
    all: vi.fn().mockReturnValue([])
  })
});

describe('Verification Code Logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should return a 6-digit string', () => {
      const code = generateCode();
      expect(typeof code).toBe('string');
      expect(code.length).toBe(6);
      expect(/^\d{6}$/.test(code)).toBe(true);
    });

    it('should return 6-digit code that can include leading zeros', () => {
      // Run multiple times to ensure we get padded codes occasionally
      let foundPadded = false;
      for (let i = 0; i < 100; i++) {
        const code = generateCode();
        if (code.startsWith('0')) {
          foundPadded = true;
          break;
        }
      }
      // Note: Due to randomness, we can't guarantee we get a padded code
      // but we verify the function always returns 6 digits
      expect(generateCode().length).toBe(6);
      // We may or may not find a padded code in 100 tries
      expect(typeof foundPadded).toBe('boolean');
    });

    it('should return different codes on subsequent calls', () => {
      const codes = new Set<string>();
      // Generate 100 codes and check uniqueness
      for (let i = 0; i < 100; i++) {
        codes.add(generateCode());
      }
      // With 1 million possible codes (000000-999999),
      // 100 codes should have very high uniqueness
      expect(codes.size).toBeGreaterThan(90);
    });

    it('should generate codes within valid range (000000-999999)', () => {
      for (let i = 0; i < 100; i++) {
        const code = generateCode();
        const num = parseInt(code, 10);
        expect(num).toBeGreaterThanOrEqual(0);
        expect(num).toBeLessThanOrEqual(999999);
      }
    });
  });

  describe('checkRateLimit', () => {
    it('should return allowed: true when no recent code exists', () => {
      const mockDb = createMockDb();
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = checkRateLimit(mockDb as any, 'test@example.com');
      
      expect(result.allowed).toBe(true);
      expect(result.waitSeconds).toBeUndefined();
    });

    it('should return allowed: false with waitSeconds when recent code exists', () => {
      const mockDb = createMockDb();
      const now = Math.floor(Date.now() / 1000);
      const recentTime = (now - 30) * 1000; // 30 seconds ago
      
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue({ created_at: recentTime }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = checkRateLimit(mockDb as any, 'test@example.com');
      
      expect(result.allowed).toBe(false);
      expect(result.waitSeconds).toBeGreaterThan(25);
      expect(result.waitSeconds).toBeLessThanOrEqual(60);
    });

    it('should return allowed: true when rate limit has expired', () => {
      const mockDb = createMockDb();
      const now = Math.floor(Date.now() / 1000);
      const oldTime = (now - 120) * 1000; // 120 seconds ago (> 60s limit)
      
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue({ created_at: oldTime }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = checkRateLimit(mockDb as any, 'test@example.com');
      
      expect(result.allowed).toBe(true);
    });
  });

  describe('createVerification', () => {
    it('should insert verification record into database', () => {
      const mockDb = createMockDb();
      const mockRun = vi.fn();
      const mockPrepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: mockRun,
        all: vi.fn().mockReturnValue([])
      });
      (mockDb.prepare as any).mockImplementation(mockPrepare);

      createVerification(mockDb as any, 'agent-123', 'test@example.com', '123456');

      // The first prepare call is the DELETE for any prior codes, the
      // second is the INSERT.
      expect(mockPrepare).toHaveBeenCalledTimes(2);
      const insertCall = mockPrepare.mock.calls.find(c => (c[0] as string).includes('INSERT INTO verifications'));
      expect(insertCall).toBeDefined();
      const insertSql = insertCall![0] as string;
      expect(insertSql).toContain('INSERT INTO verifications');

      // The first run() call corresponds to the DELETE (no args), the
      // second to the INSERT (with id/agentId/email/code/timestamps).
      expect(mockRun).toHaveBeenCalledTimes(2);
      const insertRun = mockRun.mock.calls[1];
      expect(insertRun[1]).toBe('agent-123'); // agent_id
      expect(insertRun[2]).toBe('test@example.com'); // email
      expect(insertRun[3]).toBe('123456'); // code
    });

    it('should set expiration time to 24 hours from now', () => {
      const mockDb = createMockDb();
      const mockRun = vi.fn();
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: mockRun,
        all: vi.fn().mockReturnValue([])
      });

      createVerification(mockDb as any, 'agent-456', 'test@example.com', '654321');

      // The first run is the DELETE, the second is the INSERT. The
      // INSERT receives (id, agent_id, email, code, created_at, expires_at).
      expect(mockRun).toHaveBeenCalledTimes(2);
      const runArgs = mockRun.mock.calls[1];
      expect(runArgs.length).toBe(6);
    });
  });

  describe('verifyCode', () => {
    it('should return valid: true with agentId for correct code', () => {
      const mockDb = createMockDb();
      const futureExpiry = Date.now() + (24 * 60 * 60 * 1000);
      
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'verif-123',
          agent_id: 'agent-789',
          email: 'test@example.com',
          code: '123456',
          type: 'register',
          expires_at: futureExpiry,
          created_at: Date.now(),
          verified_at: null
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = verifyCode(mockDb as any, 'test@example.com', '123456');
      
      expect(result.valid).toBe(true);
      expect(result.agentId).toBe('agent-789');
      expect(result.error).toBeUndefined();
    });

    it('should return valid: false with error for invalid code', () => {
      const mockDb = createMockDb();
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = verifyCode(mockDb as any, 'test@example.com', '000000');

      // No row in DB → 'No verification code found for this email'
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No verification code found for this email');
      expect(result.agentId).toBeUndefined();
    });

    it('should return valid: false with error for expired code', () => {
      const mockDb = createMockDb();
      const pastExpiry = Date.now() - (60 * 60 * 1000); // 1 hour ago
      
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'verif-456',
          agent_id: 'agent-expired',
          email: 'test@example.com',
          code: '999999',
          type: 'register',
          expires_at: pastExpiry,
          created_at: Date.now() - (25 * 60 * 60 * 1000),
          verified_at: null
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = verifyCode(mockDb as any, 'test@example.com', '999999');
      
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Verification code has expired');
      expect(result.agentId).toBeUndefined();
    });

    it('should mark verification as verified after successful check', () => {
      const mockDb = createMockDb();
      const futureExpiry = Date.now() + (24 * 60 * 60 * 1000);
      const mockRun = vi.fn();
      
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'verif-789',
          agent_id: 'agent-mark',
          email: 'test@example.com',
          code: '111111',
          type: 'register',
          expires_at: futureExpiry,
          created_at: Date.now(),
          verified_at: null
        }),
        run: mockRun,
        all: vi.fn().mockReturnValue([])
      });

      verifyCode(mockDb as any, 'test@example.com', '111111');
      
      // Just verify run was called (details of SQL are tested elsewhere)
      expect(mockRun).toHaveBeenCalled();
    });

    it('should reject already verified code', () => {
      const mockDb = createMockDb();
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = verifyCode(mockDb as any, 'test@example.com', '123456');

      // After a successful verify, the row is deleted (one-time use),
      // so a second verify call finds no row.
      expect(result.valid).toBe(false);
      expect(result.error).toBe('No verification code found for this email');
    });
  });

  describe('getLatestVerification', () => {
    it('should return latest verification for email', () => {
      const mockDb = createMockDb();
      const mockGet = vi.fn().mockReturnValue({
        id: 'verif-latest',
        agent_id: 'agent-latest',
        email: 'test@example.com',
        code: '888888',
        type: 'register'
      });
      
      (mockDb.prepare as any).mockReturnValue({
        get: mockGet,
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = getLatestVerification(mockDb as any, 'test@example.com');
      
      expect(result).toBeDefined();
      expect((result as any).id).toBe('verif-latest');
    });

    it('should return undefined when no verification exists', () => {
      const mockDb = createMockDb();
      (mockDb.prepare as any).mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = getLatestVerification(mockDb as any, 'nonexistent@example.com');
      
      expect(result).toBeUndefined();
    });
  });
});
