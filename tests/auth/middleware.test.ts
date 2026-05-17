/**
 * Tests for Auth Middleware
 * 
 * This module tests the JWT authentication middleware for Express.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { SignJWT } from 'jose';
import { authMiddleware, optionalAuthMiddleware } from '../../src/auth/middleware';
import { createToken } from '../../src/auth/jwt';

describe('authMiddleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let statusCode: number;
  let responseBody: any;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key';
    mockReq = { headers: {} };
    statusCode = 0;
    responseBody = null;
    mockRes = {
      status: function(code: number) {
        statusCode = code;
        return this;
      },
      json: function(body: any) {
        responseBody = body;
        return this;
      }
    };
    mockNext = function() {};
  });

  it('should return 401 when Authorization header is missing', async () => {
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Authorization header required' });
  });

  it('should return 401 when Authorization header does not start with Bearer', async () => {
    mockReq.headers.authorization = 'Basic sometoken';
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Invalid authorization format. Use: Bearer <token>' });
  });

  it('should return 401 for invalid token format', async () => {
    mockReq.headers.authorization = 'Bearer invalidtoken';
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Invalid token' });
  });

  it('should return 401 for expired token', async () => {
    // Create an expired token
    const expiredToken = await new SignJWT({ sub: 'agent123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('-1h') // Already expired
      .sign(new TextEncoder().encode('test-secret-key'));
    
    mockReq.headers.authorization = `Bearer ${expiredToken}`;
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Token expired' });
  });

  it('should call next() and set req.agent for valid token', async () => {
    const agentId = 'agent123';
    const email = 'test@example.com';
    const token = await createToken({ sub: agentId, email });
    
    mockReq.headers.authorization = `Bearer ${token}`;
    
    let nextCalled = false;
    await authMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toEqual({
      id: agentId,
      email: email
    });
    expect(statusCode).toBe(0); // Should not be set
  });

  it('should reject token with wrong signature', async () => {
    // Create a token with a different secret
    const wrongSecretToken = await new SignJWT({ sub: 'agent123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode('wrong-secret'));
    
    mockReq.headers.authorization = `Bearer ${wrongSecretToken}`;
    
    await authMiddleware(mockReq, mockRes, mockNext);
    
    expect(statusCode).toBe(401);
    expect(responseBody).toEqual({ error: 'Invalid token' });
  });
});

describe('optionalAuthMiddleware', () => {
  let mockReq: any;
  let mockRes: any;
  let mockNext: any;
  let statusCode: number;
  let responseBody: any;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret-key';
    mockReq = { headers: {} };
    statusCode = 0;
    responseBody = null;
    mockRes = {
      status: function(code: number) {
        statusCode = code;
        return this;
      },
      json: function(body: any) {
        responseBody = body;
        return this;
      }
    };
    mockNext = function() {};
  });

  it('should call next() without Authorization header', async () => {
    let nextCalled = false;
    await optionalAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toBeUndefined();
    expect(statusCode).toBe(0);
  });

  it('should call next() without Bearer prefix', async () => {
    mockReq.headers.authorization = 'Basic sometoken';
    
    let nextCalled = false;
    await optionalAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toBeUndefined();
    expect(statusCode).toBe(0);
  });

  it('should call next() and set req.agent with valid token', async () => {
    const agentId = 'agent123';
    const email = 'test@example.com';
    const token = await createToken({ sub: agentId, email });
    
    mockReq.headers.authorization = `Bearer ${token}`;
    
    let nextCalled = false;
    await optionalAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toEqual({
      id: agentId,
      email: email
    });
    expect(statusCode).toBe(0);
  });

  it('should call next() even with invalid token (ignores errors)', async () => {
    mockReq.headers.authorization = 'Bearer invalidtoken';
    
    let nextCalled = false;
    await optionalAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toBeUndefined();
    expect(statusCode).toBe(0);
  });

  it('should call next() even with wrong signature token (ignores errors)', async () => {
    const wrongSecretToken = await new SignJWT({ sub: 'agent123', email: 'test@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('24h')
      .sign(new TextEncoder().encode('wrong-secret'));
    
    mockReq.headers.authorization = `Bearer ${wrongSecretToken}`;
    
    let nextCalled = false;
    await optionalAuthMiddleware(mockReq, mockRes, () => { nextCalled = true; });
    
    expect(nextCalled).toBe(true);
    expect(mockReq.agent).toBeUndefined();
    expect(statusCode).toBe(0);
  });
});
