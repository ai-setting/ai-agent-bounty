/**
 * Auth Middleware for Bounty Platform
 *
 * This module provides Express middleware for JWT authentication.
 */

import { jwtVerify, JWTPayload } from 'jose';
import { hostname } from 'os';

const isProduction = () => process.env.NODE_ENV === 'production';

let warnedFallback = false;

/**
 * Get the JWT secret from environment variable.
 *
 * Same fallback semantics as src/auth/jwt.ts: in dev, derive a stable
 * secret when JWT_SECRET is not set; in production, hard-fail.
 *
 * @throws Error if JWT_SECRET is not set in production.
 */
const getSecret = (): Uint8Array => {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    return new TextEncoder().encode(secret);
  }
  if (isProduction()) {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  if (!warnedFallback) {
    console.warn(
      '[Auth] JWT_SECRET not set — using a derived dev secret. ' +
        'Set JWT_SECRET for production use.'
    );
    warnedFallback = true;
  }
  const fallback = `bounty-dev-jwt-${hostname()}-${process.pid}`;
  return new TextEncoder().encode(fallback);
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
