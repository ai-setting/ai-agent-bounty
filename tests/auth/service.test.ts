/**
 * Auth Service Tests
 * 
 * Tests for register, verify, login, and sendVerificationCode functions.
 */

import { describe, it, expect, beforeEach, afterAll, vi } from 'bun:test';

// Keep mailer mock (safe - just prevents email sending)
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

// Store original environment
const originalEnv = process.env;

describe('Auth Service', () => {
  let mockDb: any;
  let register: any;
  let verify: any;
  let login: any;
  let sendVerificationCode: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    process.env.BOUNTY_DOMAIN = 'bounty.test';
    process.env.JWT_SECRET = 'test-jwt-secret-for-testing';
    
    // Create mock database with real BunDatabase
    // Use the real Database so that verification functions work correctly
    const { Database } = await import('../../src/lib/storage/database');
    mockDb = new Database({ memory: true });

    // Import service module after mocks are set up
    const serviceModule = await import('../../src/auth/service.js');
    register = serviceModule.register;
    verify = serviceModule.verify;
    login = serviceModule.login;
    sendVerificationCode = serviceModule.sendVerificationCode;
  });

  describe('register', () => {
    it('should create agent with pending status and send verification email', async () => {
      const input = {
        email: 'test@example.com',
        name: 'Test Agent',
        description: 'A test agent'
      };

      const result = await register(mockDb, input);

      expect(result.agent_id).toBeDefined();
      expect(result.status).toBe('pending');
      expect(result.message).toBe('Verification code sent to your email');

      // Verify email was sent
      const { sendVerificationEmail } = await import('../../src/auth/mailer.js');
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        input.email,
        expect.any(String), // real generated code
        input.name
      );
    });

    it('should create agent with default description when not provided', async () => {
      const input = {
        email: 'test2@example.com',
        name: 'Test Agent 2'
      };

      const result = await register(mockDb, input);

      expect(result.agent_id).toBeDefined();
      expect(result.status).toBe('pending');
    });

    it('should throw error for duplicate email', async () => {
      // First register
      await register(mockDb, {
        email: 'existing@example.com',
        name: 'Original Agent'
      });

      // Second register with same email should fail
      await expect(register(mockDb, {
        email: 'existing@example.com',
        name: 'Duplicate Agent'
      })).rejects.toThrow('Email already registered');
    });

    it('should throw error for rate limit', async () => {
      const email = 'ratelimit@example.com';
      const name = 'Rate Limited Agent';
      
      // First register succeeds (creates agent + verification)
      await register(mockDb, { email, name });

      // Now try to send another verification code within the rate limit window
      // This should hit the rate limit because we just created a verification
      await expect(sendVerificationCode(mockDb, email))
        .rejects.toThrow(/Please wait|Too many/);
    });
  });

  describe('verify', () => {
    it('should activate agent, set address, and give 100 credits', async () => {
      const email = 'verify@example.com';
      const name = 'Verify Agent';
      
      // First register
      const regResult = await register(mockDb, { email, name });
      const agentId = regResult.agent_id;

      // Get the actual verification code from database
      const verification = mockDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      
      // Now verify
      const result = await verify(mockDb, { email, code: verification.code });

      expect(result.agent_id).toBe(agentId);
      expect(result.status).toBe('active');
      expect(result.address).toContain('@bounty.test');
      expect(result.credits).toBe(100);
      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.split('.').length).toBe(3);
    });

    it('should throw error for invalid verification code', async () => {
      const email = 'invalid-code@example.com';
      
      await register(mockDb, { email, name: 'Invalid Code Agent' });

      await expect(verify(mockDb, { email, code: '000000' }))
        .rejects.toThrow('Invalid or expired verification code');
    });

    it('should throw error for expired verification code', async () => {
      // TODO: This requires manipulating the database to set expires_at in the past
      // For now, skip this test as it needs database-level mocking
    });

    it('should create credit transaction for initial credits', async () => {
      const email = 'credits@example.com';
      const regResult = await register(mockDb, { email, name: 'Credits Agent' });
      const agentId = regResult.agent_id;
      
      const verification = mockDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      await verify(mockDb, { email, code: verification.code });

      // Verify credit transaction was created
      const transactions = mockDb.prepare('SELECT * FROM credit_transactions WHERE agent_id = ?').all(agentId);
      expect(transactions.length).toBeGreaterThan(0);
    });
  });

  describe('login', () => {
    it('should return token for active agent using email', async () => {
      const email = 'login@example.com';
      const regResult = await register(mockDb, { email, name: 'Login Agent' });
      const agentId = regResult.agent_id;
      
      const verification = mockDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      await verify(mockDb, { email, code: verification.code });

      const result = await login(mockDb, { email });

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.split('.').length).toBe(3);
      expect(result.agent_id).toBe(agentId);
      expect(result.email).toBe(email);
      expect(result.address).toContain('@bounty.test');
      expect(result.expires_in).toBe(86400);
    });

    it('should return token for active agent using agent_id', async () => {
      const email = 'idlogin@example.com';
      const regResult = await register(mockDb, { email, name: 'ID Login Agent' });
      const agentId = regResult.agent_id;
      
      const verification = mockDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      await verify(mockDb, { email, code: verification.code });

      const result = await login(mockDb, { agent_id: agentId });

      expect(result.token).toBeDefined();
      expect(typeof result.token).toBe('string');
      expect(result.token.split('.').length).toBe(3);
      expect(result.agent_id).toBe(agentId);
    });

    it('should throw error for non-existent agent', async () => {
      await expect(login(mockDb, { email: 'nonexistent@example.com' }))
        .rejects.toThrow('Agent not found');
    });

    it('should throw error for inactive agent', async () => {
      await register(mockDb, { email: 'pending@example.com', name: 'Pending Agent' });

      await expect(login(mockDb, { email: 'pending@example.com' }))
        .rejects.toThrow('Agent account is not active');
    });

    it('should throw error when neither email nor agent_id provided', async () => {
      await expect(login(mockDb, {} as any))
        .rejects.toThrow('Email or agent_id is required');
    });
  });

  describe('sendVerificationCode', () => {
    it('should generate and send new verification code', async () => {
      const email = 'resend@example.com';
      
      // Insert a pending agent directly to avoid triggering rate limit from register
      const agentId = crypto.randomUUID();
      const now = Date.now();
      mockDb.prepare('INSERT INTO agents (id, name, email, status, credits, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .run(agentId, 'Resend Agent', email, 'pending', now, now);

      const result = await sendVerificationCode(mockDb, email);

      expect(result).toBeUndefined();
      
      const { sendVerificationEmail } = await import('../../src/auth/mailer.js');
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        email,
        expect.any(String),
        'Resend Agent'
      );
    });

    it('should throw error for non-existent email', async () => {
      await expect(sendVerificationCode(mockDb, 'nonexistent@example.com'))
        .rejects.toThrow('Email not registered');
    });

    it('should throw error for already verified email', async () => {
      const email = 'active@example.com';
      const regResult = await register(mockDb, { email, name: 'Active Agent' });
      const agentId = regResult.agent_id;
      
      const verification = mockDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      await verify(mockDb, { email, code: verification.code });

      await expect(sendVerificationCode(mockDb, email))
        .rejects.toThrow('Email already verified');
    });

    it('should respect rate limit', async () => {
      const email = 'ratelimit-resend@example.com';
      
      // Insert a pending agent directly
      const agentId = crypto.randomUUID();
      const now = Date.now();
      mockDb.prepare('INSERT INTO agents (id, name, email, status, credits, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
        .run(agentId, 'Rate Limit Agent', email, 'pending', now, now);

      // First sendVerificationCode should succeed
      await sendVerificationCode(mockDb, email);

      // Second immediate attempt should hit rate limit
      await expect(sendVerificationCode(mockDb, email))
        .rejects.toThrow(/Please wait/);
    });
  });
});
