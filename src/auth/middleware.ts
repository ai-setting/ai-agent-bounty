/**
 * Auth Middleware for Bounty Platform
 * 
 * This module provides Express middleware for JWT authentication.
 */

import { jwtVerify, JWTPayload } from 'jose';

/**
 * Get the JWT secret from environment variable
 * @throws Error if JWT_SECRET is not set
 */
const getSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is required');
  }
  return new TextEncoder().encode(secret);
};

/**
 * JWT payload structure for auth tokens
 */
interface AuthPayload extends JWTPayload {
  sub: string;
  email: string;
}

/**
 * Extended Request type with authenticated agent info
 */
export interface AuthenticatedRequest {
  headers: {
    authorization?: string;
    [key: string]: string | string[] | undefined;
  };
  agent?: {
    id: string;
    email: string;
  };
  [key: string]: any;
}

/**
 * Response type for Express
 */
export interface Response {
  status(code: number): this;
  json(body: any): this;
}

/**
 * Next function type
 */
export type NextFunction = () => void;

/**
 * Authentication middleware that requires a valid JWT token
 * 
 * Extracts the Bearer token from Authorization header and verifies it.
 * Sets req.agent with the decoded token payload if valid.
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    res.status(401).json({ error: 'Authorization header required' });
    return;
  }
  
  if (!authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Invalid authorization format. Use: Bearer <token>' });
    return;
  }
  
  const token = authHeader.slice(7);
  
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const authPayload = payload as AuthPayload;
    req.agent = {
      id: authPayload.sub,
      email: authPayload.email
    };
    next();
  } catch (error: any) {
    // Check for expired token by error code
    if (error.code === 'ERR_JWT_EXPIRED') {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}

/**
 * Optional authentication middleware that allows unauthenticated requests
 * 
 * If a valid Bearer token is provided, it will be verified and req.agent will be set.
 * If no token or invalid token is provided, the request will continue without req.agent.
 * This is useful for endpoints that behave differently for authenticated vs anonymous users.
 * 
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    next();
    return;
  }
  
  const token = authHeader.slice(7);
  
  try {
    const { payload } = await jwtVerify(token, getSecret());
    const authPayload = payload as AuthPayload;
    req.agent = {
      id: authPayload.sub,
      email: authPayload.email
    };
  } catch {
    // Ignore errors for optional auth
  }
  
  next();
}
