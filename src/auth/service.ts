/**
 * Auth Service for Bounty Platform
 * 
 * This module provides the main authentication business logic including:
 * - Agent registration with email verification
 * - Email verification and account activation
 * - Login with token generation
 * - Resending verification codes
 */

import { createToken, getTokenExpiry } from './jwt.js';
import { sendVerificationEmail } from './mailer.js';
import { generateCode, createVerification, verifyCode, checkRateLimit } from './verification.js';

const INITIAL_CREDITS = 100;

/**
 * Register a new agent
 * Creates a pending agent and sends a verification email
 * 
 * @param db - Database instance
 * @param input - Registration input (email, name, optional description)
 * @returns RegisterResponse with agent_id and pending status
 * @throws Error if email already registered or rate limited
 */
export async function register(db: any, input: { email: string; name: string; description?: string }): Promise<{
  agent_id: string;
  status: 'pending';
  message: string;
}> {
  // Check if email already exists
  const existing = db.prepare('SELECT id FROM agents WHERE email = ?').get(input.email);
  if (existing) {
    throw new Error('Email already registered');
  }
  
  // Check rate limit
  const rateLimit = checkRateLimit(db, input.email);
  if (!rateLimit.allowed) {
    throw new Error(`Please wait ${rateLimit.waitSeconds} seconds before requesting another code`);
  }
  
  // Create agent with pending status
  const agentId = generateUUID();
  const now = Date.now();
  
  db.prepare(`
    INSERT INTO agents (id, name, email, description, status, credits, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)
  `).run(agentId, input.name, input.email, input.description || '', now, now);
  
  // Generate and store verification code
  const code = generateCode();
  createVerification(db, agentId, input.email, code);
  
  // Send verification email
  await sendVerificationEmail(input.email, code, input.name);
  
  return {
    agent_id: agentId,
    status: 'pending',
    message: 'Verification code sent to your email'
  };
}

/**
 * Verify email and activate agent
 * Activates the agent account, sets address, and awards initial credits
 * 
 * @param db - Database instance
 * @param input - Verification input (email, code)
 * @returns VerifyResponse with agent details, token, and credits
 * @throws Error if verification code is invalid or expired
 */
export async function verify(db: any, input: { email: string; code: string }): Promise<{
  agent_id: string;
  status: 'active';
  address: string;
  token: string;
  credits: number;
}> {
  const result = verifyCode(db, input.email, input.code);
  
  if (!result.valid) {
    throw new Error(result.error || 'Verification failed');
  }
  
  const domain = process.env.BOUNTY_DOMAIN || 'bounty.local';
  const address = `${result.agentId}@${domain}`;
  
  // Update agent status and address
  const now = Date.now();
  db.prepare(`
    UPDATE agents SET status = 'active', address = ?, credits = ?, updated_at = ?
    WHERE id = ?
  `).run(address, INITIAL_CREDITS, now, result.agentId);
  
  // Create credit transaction
  db.prepare(`
    INSERT INTO credit_transactions (id, agent_id, amount, type, description, created_at)
    VALUES (?, ?, ?, 'reward', 'Welcome bonus', ?)
  `).run(generateUUID(), result.agentId, INITIAL_CREDITS, now);
  
  // Generate token
  const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(result.agentId) as any;
  const token = await createToken({ sub: agent.id, email: agent.email });
  
  return {
    agent_id: agent.id,
    status: 'active',
    address,
    token,
    credits: INITIAL_CREDITS
  };
}

/**
 * Login and get authentication token
 * Returns a JWT token for authenticated API access
 * 
 * @param db - Database instance
 * @param input - Login input (email or agent_id)
 * @returns AuthResponse with token and agent details
 * @throws Error if agent not found or not active
 */
export async function login(db: any, input: { email?: string; agent_id?: string }): Promise<{
  token: string;
  expires_in: number;
  agent_id: string;
  email: string;
  address?: string;
}> {
  let agent: any;
  
  if (input.agent_id) {
    agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(input.agent_id);
  } else if (input.email) {
    agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(input.email);
  } else {
    throw new Error('Email or agent_id is required');
  }
  
  if (!agent) {
    throw new Error('Agent not found');
  }
  
  if (agent.status !== 'active') {
    throw new Error('Agent account is not active. Please verify your email first.');
  }
  
  const token = await createToken({ sub: agent.id, email: agent.email });
  
  return {
    token,
    expires_in: getTokenExpiry(),
    agent_id: agent.id,
    email: agent.email,
    address: agent.address
  };
}

/**
 * Send a new verification code
 * Used when user needs to resend the verification email
 * 
 * @param db - Database instance
 * @param email - Email address to send verification code to
 * @throws Error if email not registered, already verified, or rate limited
 */
export async function sendVerificationCode(db: any, email: string): Promise<void> {
  const agent = db.prepare('SELECT * FROM agents WHERE email = ?').get(email) as any;
  
  if (!agent) {
    throw new Error('Email not registered');
  }
  
  if (agent.status === 'active') {
    throw new Error('Email already verified');
  }
  
  const rateLimit = checkRateLimit(db, email);
  if (!rateLimit.allowed) {
    throw new Error(`Please wait ${rateLimit.waitSeconds} seconds before requesting another code`);
  }
  
  const code = generateCode();
  createVerification(db, agent.id, email, code);
  
  await sendVerificationEmail(email, code, agent.name);
}

/**
 * Generate a UUID v4 string
 * Used for generating unique IDs for agents and transactions
 */
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
