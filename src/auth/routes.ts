/**
 * Auth Routes for Bounty Platform
 * 
 * Express route handlers for authentication endpoints:
 * - POST /api/auth/register - Register a new agent
 * - POST /api/auth/verify - Verify email and activate account
 * - POST /api/auth/login - Login and get authentication token
 * - POST /api/auth/send-code - Resend verification code
 */

import type { Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { register, verify, login, sendVerificationCode } from './service.js';

/**
 * Create auth route handlers
 * Returns an object with all route handlers
 * 
 * @param db - Database instance
 * @returns Object containing all route handlers
 */
export function createAuthRoutes(db: Database.Database) {
  /**
   * POST /api/auth/register
   * Register a new agent with email verification
   */
  const registerRoute = async (req: Request, res: Response) => {
    try {
      const input = req.body;
      
      if (!input.email || !input.name) {
        res.status(400).json({ error: 'Email and name are required' });
        return;
      }
      
      if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(input.email)) {
        res.status(400).json({ error: 'Invalid email format' });
        return;
      }
      
      const result = await register(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      res.status(400).json({ error: message });
    }
  };
  
  /**
   * POST /api/auth/verify
   * Verify email with code and activate agent account
   */
  const verifyRoute = async (req: Request, res: Response) => {
    try {
      const input = req.body;
      
      if (!input.email || !input.code) {
        res.status(400).json({ error: 'Email and code are required' });
        return;
      }
      
      const result = await verify(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      res.status(400).json({ error: message });
    }
  };
  
  /**
   * POST /api/auth/login
   * Login with email or agent_id and get authentication token
   */
  const loginRoute = async (req: Request, res: Response) => {
    try {
      const input = req.body;
      
      if (!input.email && !input.agent_id) {
        res.status(400).json({ error: 'Email or agent_id is required' });
        return;
      }
      
      const result = await login(db, input);
      res.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      res.status(401).json({ error: message });
    }
  };
  
  /**
   * POST /api/auth/send-code
   * Resend verification code to email
   */
  const sendCodeRoute = async (req: Request, res: Response) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        res.status(400).json({ error: 'Email is required' });
        return;
      }
      
      await sendVerificationCode(db, email);
      res.json({ message: 'Verification code sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      res.status(400).json({ error: message });
    }
  };
  
  return {
    registerRoute,
    verifyRoute,
    loginRoute,
    sendCodeRoute
  };
}
