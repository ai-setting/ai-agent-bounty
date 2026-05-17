/**
 * Auth Routes Tests
 * 
 * Tests for Express route handlers: registerRoute, verifyRoute, loginRoute, sendCodeRoute
 */

import { describe, it, expect, beforeEach, vi } from 'bun:test';

// Mock service functions
vi.mock('../../src/auth/service.js', () => ({
  register: vi.fn(),
  verify: vi.fn(),
  login: vi.fn(),
  sendVerificationCode: vi.fn()
}));

// Mock Express types
const mockReq = (body: any = {}) => ({
  body
}) as any;

const mockRes = () => {
  const res: any = {
    statusCode: 200,
    body: null as any,
    status: function(code: number) {
      this.statusCode = code;
      return this;
    },
    json: function(data: any) {
      this.body = data;
      return this;
    }
  };
  return res;
};

describe('Auth Routes', () => {
  let routes: any;
  let register: any;
  let verify: any;
  let login: any;
  let sendVerificationCode: any;
  let mockDb: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Import service mocks
    const serviceModule = await import('../../src/auth/service.js');
    register = serviceModule.register;
    verify = serviceModule.verify;
    login = serviceModule.login;
    sendVerificationCode = serviceModule.sendVerificationCode;
    
    // Import routes module
    const { createAuthRoutes } = await import('../../src/auth/routes.js');
    
    // Create mock database
    mockDb = {};
    
    // Create routes with mock db
    routes = createAuthRoutes(mockDb);
  });

  describe('registerRoute', () => {
    it('should return 400 when email is missing', async () => {
      const req = mockReq({ name: 'Test Agent' });
      const res = mockRes();

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email and name are required' });
    });

    it('should return 400 when name is missing', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email and name are required' });
    });

    it('should return 400 for invalid email format', async () => {
      const req = mockReq({ email: 'invalid-email', name: 'Test Agent' });
      const res = mockRes();

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for email without @ symbol', async () => {
      const req = mockReq({ email: 'invalidemail.com', name: 'Test Agent' });
      const res = mockRes();

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid email format' });
    });

    it('should return 400 for email without domain', async () => {
      const req = mockReq({ email: 'test@', name: 'Test Agent' });
      const res = mockRes();

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid email format' });
    });

    it('should call register service on valid input', async () => {
      const req = mockReq({
        email: 'test@example.com',
        name: 'Test Agent',
        description: 'A test agent'
      });
      const res = mockRes();

      register.mockResolvedValue({
        agent_id: 'test-agent-id',
        status: 'pending',
        message: 'Verification code sent'
      });

      await routes.registerRoute(req, res);

      expect(register).toHaveBeenCalledWith(mockDb, {
        email: 'test@example.com',
        name: 'Test Agent',
        description: 'A test agent'
      });
      expect(res.body).toEqual({
        agent_id: 'test-agent-id',
        status: 'pending',
        message: 'Verification code sent'
      });
    });

    it('should return 400 on service error', async () => {
      const req = mockReq({ email: 'test@example.com', name: 'Test Agent' });
      const res = mockRes();

      register.mockRejectedValue(new Error('Email already registered'));

      await routes.registerRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email already registered' });
    });
  });

  describe('verifyRoute', () => {
    it('should return 400 when email is missing', async () => {
      const req = mockReq({ code: '123456' });
      const res = mockRes();

      await routes.verifyRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email and code are required' });
    });

    it('should return 400 when code is missing', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      await routes.verifyRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email and code are required' });
    });

    it('should return 400 when both email and code are missing', async () => {
      const req = mockReq({});
      const res = mockRes();

      await routes.verifyRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email and code are required' });
    });

    it('should call verify service on valid input', async () => {
      const req = mockReq({ email: 'test@example.com', code: '123456' });
      const res = mockRes();

      verify.mockResolvedValue({
        agent_id: 'test-agent-id',
        status: 'active',
        address: 'test-agent-id@bounty.test',
        token: 'jwt-token',
        credits: 100
      });

      await routes.verifyRoute(req, res);

      expect(verify).toHaveBeenCalledWith(mockDb, {
        email: 'test@example.com',
        code: '123456'
      });
      expect(res.body).toEqual({
        agent_id: 'test-agent-id',
        status: 'active',
        address: 'test-agent-id@bounty.test',
        token: 'jwt-token',
        credits: 100
      });
    });

    it('should return 400 on service error', async () => {
      const req = mockReq({ email: 'test@example.com', code: '123456' });
      const res = mockRes();

      verify.mockRejectedValue(new Error('Invalid verification code'));

      await routes.verifyRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Invalid verification code' });
    });
  });

  describe('loginRoute', () => {
    it('should return 400 when both email and agent_id are missing', async () => {
      const req = mockReq({});
      const res = mockRes();

      await routes.loginRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email or agent_id is required' });
    });

    it('should call login service with email', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      login.mockResolvedValue({
        token: 'jwt-token',
        expires_in: 86400,
        agent_id: 'test-agent-id',
        email: 'test@example.com',
        address: 'test-agent-id@bounty.test'
      });

      await routes.loginRoute(req, res);

      expect(login).toHaveBeenCalledWith(mockDb, { email: 'test@example.com' });
      expect(res.body).toEqual({
        token: 'jwt-token',
        expires_in: 86400,
        agent_id: 'test-agent-id',
        email: 'test@example.com',
        address: 'test-agent-id@bounty.test'
      });
    });

    it('should call login service with agent_id', async () => {
      const req = mockReq({ agent_id: 'test-agent-id' });
      const res = mockRes();

      login.mockResolvedValue({
        token: 'jwt-token',
        expires_in: 86400,
        agent_id: 'test-agent-id',
        email: 'test@example.com',
        address: 'test-agent-id@bounty.test'
      });

      await routes.loginRoute(req, res);

      expect(login).toHaveBeenCalledWith(mockDb, { agent_id: 'test-agent-id' });
      expect(res.body).toEqual({
        token: 'jwt-token',
        expires_in: 86400,
        agent_id: 'test-agent-id',
        email: 'test@example.com',
        address: 'test-agent-id@bounty.test'
      });
    });

    it('should return 401 on service error', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      login.mockRejectedValue(new Error('Invalid credentials'));

      await routes.loginRoute(req, res);

      expect(res.statusCode).toBe(401);
      expect(res.body).toEqual({ error: 'Invalid credentials' });
    });
  });

  describe('sendCodeRoute', () => {
    it('should return 400 when email is missing', async () => {
      const req = mockReq({});
      const res = mockRes();

      await routes.sendCodeRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email is required' });
    });

    it('should call sendVerificationCode service on valid email', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      sendVerificationCode.mockResolvedValue(undefined);

      await routes.sendCodeRoute(req, res);

      expect(sendVerificationCode).toHaveBeenCalledWith(mockDb, 'test@example.com');
      expect(res.body).toEqual({ message: 'Verification code sent' });
    });

    it('should return 400 on service error', async () => {
      const req = mockReq({ email: 'test@example.com' });
      const res = mockRes();

      sendVerificationCode.mockRejectedValue(new Error('Email not registered'));

      await routes.sendCodeRoute(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({ error: 'Email not registered' });
    });
  });
});
