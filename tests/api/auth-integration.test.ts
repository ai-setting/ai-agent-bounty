import { describe, test, expect, beforeEach, afterEach, beforeAll } from 'bun:test';
import { IMHTTPServer } from '../../src/im/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

// Set up test environment before importing auth modules
process.env.JWT_SECRET = 'test-secret-key';
process.env.BOUNTY_DOMAIN = 'test.local';

describe('Auth Integration', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: IMHTTPServer;
  let baseUrl: string;

  beforeAll(async () => {
    // Initialize both databases
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
  });

  beforeEach(async () => {
    // Clear data but keep schema
    bountyDb.prepare('DELETE FROM credit_transactions').run();
    bountyDb.prepare('DELETE FROM verifications').run();
    bountyDb.prepare('DELETE FROM agents').run();
    
    server = new IMHTTPServer(imDb, 0, bountyDb);
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(() => {
    server.stop();
  });

  describe('POST /api/auth/register', () => {
    test('creates pending agent and returns agent_id', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com',
          name: 'Test Agent'
        })
      });
      
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('agent_id');
      expect(body.status).toBe('pending');
      expect(body.message).toBeTruthy();
    });

    test('returns 400 when email is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Test Agent'
        })
      });
      
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    test('returns 400 when name is missing', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@example.com'
        })
      });
      
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/agents/me', () => {
    test('returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/agents/me`, {
        method: 'GET'
      });
      
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body).toHaveProperty('error');
    });

    test('returns 401 with invalid token', async () => {
      const res = await fetch(`${baseUrl}/api/agents/me`, {
        method: 'GET',
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
      
      expect(res.status).toBe(401);
    });

    test('returns agent data with valid token', async () => {
      // First register and verify an agent
      const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'me@test.com',
          name: 'Me Agent'
        })
      });
      const registerBody = await registerRes.json();
      const agentId = registerBody.agent_id;

      // Get the verification code from the database
      const verification = bountyDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      
      // Verify the agent
      await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'me@test.com',
          code: verification.code
        })
      });

      // Login to get a token
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'me@test.com'
        })
      });
      const loginBody = await loginRes.json();
      const token = loginBody.token;

      // Access protected endpoint with valid token
      const meRes = await fetch(`${baseUrl}/api/agents/me`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      
      expect(meRes.status).toBe(200);
      const meBody = await meRes.json();
      expect(meBody.id).toBe(agentId);
      expect(meBody.email).toBe('me@test.com');
      expect(meBody.status).toBe('active');
    });
  });

  describe('GET /api/agents/me/credits', () => {
    test('returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/agents/me/credits`, {
        method: 'GET'
      });
      
      expect(res.status).toBe(401);
    });

    test('returns credits with valid token', async () => {
      // Register and verify an agent
      const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'credits@test.com',
          name: 'Credits Agent'
        })
      });
      const registerBody = await registerRes.json();
      const agentId = registerBody.agent_id;

      // Get the verification code from the database
      const verification = bountyDb.prepare('SELECT code FROM verifications WHERE agent_id = ?').get(agentId) as any;
      
      // Verify the agent
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'credits@test.com',
          code: verification.code
        })
      });
      const verifyBody = await verifyRes.json();

      // Access credits endpoint
      const creditsRes = await fetch(`${baseUrl}/api/agents/me/credits`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${verifyBody.token}`
        }
      });
      
      expect(creditsRes.status).toBe(200);
      const creditsBody = await creditsRes.json();
      expect(creditsBody).toHaveProperty('credits');
      expect(creditsBody.credits).toBe(100); // Initial credits from verification
      expect(creditsBody).toHaveProperty('transactions');
      expect(Array.isArray(creditsBody.transactions)).toBe(true);
      expect(creditsBody.transactions.length).toBe(1);
      expect(creditsBody.transactions[0].type).toBe('reward');
      expect(creditsBody.transactions[0].description).toBe('Welcome bonus');
    });
  });

  describe('Protected business routes', () => {
    test('GET /api/messages returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/messages`, {
        method: 'GET'
      });
      
      expect(res.status).toBe(401);
    });

    test('POST /api/messages returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Hello!' }
        })
      });
      
      expect(res.status).toBe(401);
    });

    test('GET /api/tasks returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'GET'
      });
      
      expect(res.status).toBe(401);
    });

    test('POST /api/tasks returns 401 without token', async () => {
      const res = await fetch(`${baseUrl}/api/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: 'Test Task',
          description: 'Test description',
          reward: 100
        })
      });
      
      expect(res.status).toBe(401);
    });
  });

  describe('Public auth routes', () => {
    test('POST /api/auth/login returns 401 for non-existent agent', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@test.com'
        })
      });
      
      // Returns 401 for security - don't reveal if agent exists
      expect(res.status).toBe(401);
    });

    test('POST /api/auth/send-code returns 400 for missing email', async () => {
      const res = await fetch(`${baseUrl}/api/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      
      expect(res.status).toBe(400);
    });

    test('POST /api/auth/verify returns 400 for missing fields', async () => {
      const res = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'test@test.com'
          // missing code
        })
      });
      
      expect(res.status).toBe(400);
    });

    test('Full auth flow: register -> verify -> login', async () => {
      // 1. Register
      const registerRes = await fetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'flow@test.com',
          name: 'Flow Agent'
        })
      });
      expect(registerRes.status).toBe(200);
      const registerBody = await registerRes.json();
      expect(registerBody.status).toBe('pending');

      // 2. Get verification code
      const verification = bountyDb.prepare('SELECT code FROM verifications WHERE email = ?').get('flow@test.com') as any;
      expect(verification).toBeTruthy();

      // 3. Verify
      const verifyRes = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'flow@test.com',
          code: verification.code
        })
      });
      expect(verifyRes.status).toBe(200);
      const verifyBody = await verifyRes.json();
      expect(verifyBody.status).toBe('active');
      expect(verifyBody.token).toBeTruthy();
      expect(verifyBody.credits).toBe(100);

      // 4. Login
      const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'flow@test.com'
        })
      });
      expect(loginRes.status).toBe(200);
      const loginBody = await loginRes.json();
      expect(loginBody.token).toBeTruthy();
      expect(loginBody.agent_id).toBeTruthy();
    });
  });
});
