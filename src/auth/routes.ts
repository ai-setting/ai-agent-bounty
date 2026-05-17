/**
 * Auth Routes for Bounty Platform
 * 
 * Route handlers for authentication endpoints:
 * - POST /api/auth/register - Register a new agent
 * - POST /api/auth/verify - Verify email and activate account
 * - POST /api/auth/login - Login and get authentication token
 * - POST /api/auth/send-code - Resend verification code
 */

import type { Database } from '../lib/storage/database';
import { register, verify, login, sendVerificationCode } from './service.js';

export interface RouteContext {
  db: Database;
}

/**
 * Create auth route handlers
 * Returns an object with all route handlers
 * 
 * @param db - Database instance
 * @returns Object containing all route handlers
 */
export function createAuthRoutes(db: Database) {
  /**
   * POST /api/auth/register
   * Register a new agent with email verification
   */
  const registerRoute = async (req: Request): Promise<Response> => {
    try {
      let input: { email?: string; name?: string; description?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.name) {
        return Response.json({ error: 'Email and name are required' }, { status: 400 });
      }
      
      if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(input.email)) {
        return Response.json({ error: 'Invalid email format' }, { status: 400 });
      }
      
      const result = await register(db, {
        email: input.email!,
        name: input.name!,
        description: input.description
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      return Response.json({ error: message }, { status: 400 });
    }
  };
  
  /**
   * POST /api/auth/verify
   * Verify email with code and activate agent account
   */
  const verifyRoute = async (req: Request): Promise<Response> => {
    try {
      let input: { email?: string; code?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.code) {
        return Response.json({ error: 'Email and code are required' }, { status: 400 });
      }
      
      const result = await verify(db, {
        email: input.email!,
        code: input.code!
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      return Response.json({ error: message }, { status: 400 });
    }
  };
  
  /**
   * POST /api/auth/login
   * Login with email or agent_id and get authentication token
   */
  const loginRoute = async (req: Request): Promise<Response> => {
    try {
      let input: { email?: string; agent_id?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email && !input.agent_id) {
        return Response.json({ error: 'Email or agent_id is required' }, { status: 400 });
      }
      
      const result = await login(db, {
        email: input.email,
        agent_id: input.agent_id
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      return Response.json({ error: message }, { status: 401 });
    }
  };
  
  /**
   * POST /api/auth/send-code
   * Resend verification code to email
   */
  const sendCodeRoute = async (req: Request): Promise<Response> => {
    try {
      let input: { email?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email) {
        return Response.json({ error: 'Email is required' }, { status: 400 });
      }
      
      await sendVerificationCode(db, input.email);
      return Response.json({ message: 'Verification code sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      return Response.json({ error: message }, { status: 400 });
    }
  };
  
  return {
    registerRoute,
    verifyRoute,
    loginRoute,
    sendCodeRoute
  };
}
