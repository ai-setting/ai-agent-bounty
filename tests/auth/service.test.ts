/**
 * Auth Service Tests
 * 
 * Tests for register, verify, login, and sendVerificationCode functions.
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';

// Mock external dependencies before importing service
vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('../../src/auth/jwt.js', () => ({
  createToken: vi.fn().mockResolvedValue('mock-token'),
  getTokenExpiry: vi.fn().mockReturnValue(86400)
}));

// Store original environment
const originalEnv = process.env;

describe('Auth Service', () => {
  let mockDb: any;
  let register: any;
  let verify: any;
  let login: any;
  let sendVerificationCode: any;
  let verificationModule: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    process.env.BOUNTY_DOMAIN = 'bounty.test';
    
    // Reset verification module mocks
    vi.mock('../../src/auth/verification.js', () => ({
      generateCode: vi.fn().mockReturnValue('123456'),
      createVerification: vi.fn(),
      verifyCode: vi.fn().mockReturnValue({ valid: false, error: 'Not mocked' }),
      checkRateLimit: vi.fn().mockReturnValue({ allowed: true })
    }));

    // Create mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(null),
        run: vi.fn().mockReturnValue({ changes: 1 }),
        all: vi.fn().mockReturnValue([])
      })
    };

    // Import service module after mocks are set up
    const serviceModule = await import('../../src/auth/service.js');
    register = serviceModule.register;
    verify = serviceModule.verify;
    login = serviceModule.login;
    sendVerificationCode = serviceModule.sendVerificationCode;
    
    // Get verification module reference
    verificationModule = await import('../../src/auth/verification.js');
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

      // Verify agent was created in database
      expect(mockDb.prepare).toHaveBeenCalled();
      const insertCall = mockDb.prepare.mock.calls.find(
        (call: any) => call[0].includes('INSERT INTO agents')
      );
      expect(insertCall).toBeDefined();

      // Verify email was sent
      const { sendVerificationEmail } = await import('../../src/auth/mailer.js');
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        input.email,
        '123456', // mocked code
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
      // Mock existing agent
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({ id: 'existing-agent' }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const input = {
        email: 'existing@example.com',
        name: 'Duplicate Agent'
      };

      await expect(register(mockDb, input)).rejects.toThrow('Email already registered');
    });

    it('should throw error for rate limit', async () => {
      // Mock rate limit exceeded
      verificationModule.checkRateLimit.mockReturnValue({ allowed: false, waitSeconds: 45 });

      const input = {
        email: 'rate-limited@example.com',
        name: 'Rate Limited Agent'
      };

      await expect(register(mockDb, input)).rejects.toThrow(/Please wait/);
      await expect(register(mockDb, input)).rejects.toThrow(/45 seconds/);
    });
  });

  describe('verify', () => {
    it('should activate agent, set address, and give 100 credits', async () => {
      const agentId = 'agent-verify-123';
      const input = {
        email: 'verify@example.com',
        code: '123456'
      };

      // Mock verifyCode to return valid result
      verificationModule.verifyCode.mockReturnValue({
        valid: true,
        agentId: agentId
      });

      // Mock agent lookup (used twice: once for update, once for token generation)
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: agentId,
          email: input.email,
          name: 'Test Agent',
          status: 'pending',
          credits: 0
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = await verify(mockDb, input);

      expect(result.agent_id).toBe(agentId);
      expect(result.status).toBe('active');
      expect(result.address).toContain('@bounty.test');
      expect(result.credits).toBe(100);
      expect(result.token).toBe('mock-token');

      // Verify agent was updated (check for UPDATE call)
      const updateCalls = mockDb.prepare.mock.calls.filter(
        (call: any) => call[0].includes('UPDATE agents')
      );
      expect(updateCalls.length).toBeGreaterThan(0);
    });

    it('should throw error for invalid verification code', async () => {
      const input = {
        email: 'invalid@example.com',
        code: '000000'
      };

      // Mock verifyCode to return invalid result
      verificationModule.verifyCode.mockReturnValue({
        valid: false,
        error: 'Invalid or expired verification code'
      });

      await expect(verify(mockDb, input)).rejects.toThrow('Invalid or expired verification code');
    });

    it('should throw error for expired verification code', async () => {
      const input = {
        email: 'expired@example.com',
        code: '999999'
      };

      // Mock verifyCode to return expired result
      verificationModule.verifyCode.mockReturnValue({
        valid: false,
        error: 'Verification code has expired'
      });

      await expect(verify(mockDb, input)).rejects.toThrow('Verification code has expired');
    });

    it('should create credit transaction for initial credits', async () => {
      const agentId = 'agent-credits-123';
      const input = {
        email: 'credits@example.com',
        code: '123456'
      };

      // Mock verifyCode to return valid result
      verificationModule.verifyCode.mockReturnValue({
        valid: true,
        agentId: agentId
      });

      // Mock agent lookup
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: agentId,
          email: input.email,
          name: 'Test Agent',
          status: 'pending',
          credits: 0
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      await verify(mockDb, input);

      // Verify credit transaction was created
      const insertCalls = mockDb.prepare.mock.calls.filter(
        (call: any) => call[0].includes('INSERT INTO credit_transactions')
      );
      expect(insertCalls.length).toBeGreaterThan(0);
    });
  });

  describe('login', () => {
    it('should return token for active agent using email', async () => {
      const agent = {
        id: 'agent-login-123',
        email: 'login@example.com',
        status: 'active',
        address: 'agent-login-123@bounty.test'
      };

      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(agent),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = await login(mockDb, { email: 'login@example.com' });

      expect(result.token).toBe('mock-token');
      expect(result.agent_id).toBe(agent.id);
      expect(result.email).toBe(agent.email);
      expect(result.address).toBe(agent.address);
      expect(result.expires_in).toBe(86400);
    });

    it('should return token for active agent using agent_id', async () => {
      const agent = {
        id: 'agent-id-login-456',
        email: 'idlogin@example.com',
        status: 'active',
        address: 'agent-id-login-456@bounty.test'
      };

      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(agent),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      const result = await login(mockDb, { agent_id: 'agent-id-login-456' });

      expect(result.token).toBe('mock-token');
      expect(result.agent_id).toBe(agent.id);
    });

    it('should throw error for non-existent agent', async () => {
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      await expect(login(mockDb, { email: 'nonexistent@example.com' }))
        .rejects.toThrow('Agent not found');
    });

    it('should throw error for inactive agent', async () => {
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'pending-agent',
          email: 'pending@example.com',
          status: 'pending'
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

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
      
      // Mock existing agent with pending status
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'agent-resend',
          email: email,
          name: 'Resend Agent',
          status: 'pending'
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      await sendVerificationCode(mockDb, email);

      // Verify email was sent
      const { sendVerificationEmail } = await import('../../src/auth/mailer.js');
      expect(sendVerificationEmail).toHaveBeenCalledWith(
        email,
        '123456', // mocked code
        'Resend Agent'
      );
    });

    it('should throw error for non-existent email', async () => {
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue(undefined),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      await expect(sendVerificationCode(mockDb, 'nonexistent@example.com'))
        .rejects.toThrow('Email not registered');
    });

    it('should throw error for already verified email', async () => {
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'verified-agent',
          email: 'verified@example.com',
          name: 'Verified Agent',
          status: 'active'
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      await expect(sendVerificationCode(mockDb, 'verified@example.com'))
        .rejects.toThrow('Email already verified');
    });

    it('should respect rate limit', async () => {
      const email = 'rate-limited@example.com';
      
      // Mock existing agent with pending status
      mockDb.prepare = vi.fn().mockReturnValue({
        get: vi.fn().mockReturnValue({
          id: 'agent-rate',
          email: email,
          name: 'Rate Limited Agent',
          status: 'pending'
        }),
        run: vi.fn(),
        all: vi.fn().mockReturnValue([])
      });

      // Mock rate limit exceeded
      verificationModule.checkRateLimit.mockReturnValue({ allowed: false, waitSeconds: 45 });

      await expect(sendVerificationCode(mockDb, email))
        .rejects.toThrow(/Please wait/);
    });
  });
});
