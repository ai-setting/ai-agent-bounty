/**
 * Authentication Types for Bounty Platform
 * 
 * This module defines all types related to authentication, including:
 * - Token payloads for JWT
 * - Input types for auth operations
 * - Response types for auth endpoints
 * - Agent profile types
 */

/**
 * JWT Token payload structure
 * Contains the agent_id and email extracted from the token
 */
export type AuthTokenPayload = {
  /** Agent ID (subject) */
  sub: string;
  /** Agent email (optional) */
  email?: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiration timestamp */
  exp: number;
};

/**
 * Input type for agent registration
 */
export type RegisterInput = {
  /** Agent email address */
  email: string;
  /** Agent display name */
  name: string;
  /** Optional agent description */
  description?: string;
};

/**
 * Input type for sending verification code
 */
export type SendCodeInput = {
  /** Email address to send verification code to */
  email: string;
};

/**
 * Input type for verifying email with code
 */
export type VerifyInput = {
  /** Email address being verified */
  email: string;
  /** 6-digit verification code */
  code: string;
};

/**
 * Input type for login
 * Either email or agent_id can be used
 */
export type LoginInput = {
  /** Agent email for login */
  email?: string;
  /** Agent ID for login */
  agent_id?: string;
};

/**
 * Response type for successful authentication (login)
 */
export type AuthResponse = {
  /** JWT Bearer token */
  token: string;
  /** Token expiration time in seconds */
  expires_in: number;
  /** Agent ID */
  agent_id: string;
  /** Agent email */
  email: string;
  /** Agent address (agent_id@domain), optional */
  address?: string;
};

/**
 * Response type for successful registration
 */
export type RegisterResponse = {
  /** Newly created agent ID */
  agent_id: string;
  /** Agent status (always 'pending' after registration) */
  status: 'pending';
  /** Response message */
  message: string;
};

/**
 * Response type for successful email verification
 */
export type VerifyResponse = {
  /** Verified agent ID */
  agent_id: string;
  /** Agent status (always 'active' after verification) */
  status: 'active';
  /** Agent address (agent_id@domain) */
  address: string;
  /** JWT Bearer token */
  token: string;
  /** Initial credits awarded on verification */
  credits: number;
};

/**
 * Agent profile structure
 */
export type AgentProfile = {
  /** Agent ID */
  id: string;
  /** Agent display name */
  name: string;
  /** Agent email */
  email: string;
  /** Agent address (agent_id@domain), optional */
  address?: string;
  /** Agent description, optional */
  description?: string;
  /** Agent credits balance */
  credits: number;
  /** Agent status (pending, active, etc.) */
  status: string;
  /** Creation timestamp */
  created_at: number;
};
