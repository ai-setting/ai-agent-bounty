/**
 * Bounty Server HTTP Module
 * 
 * Provides HTTP server for:
 * - Auth: Authentication and agent management
 * - Bounty: Task publishing, grabbing, completion
 * - IM: Agent messaging (HTTP long-polling fallback)
 */

export { IMHTTPServer as BountyHTTPServer } from '../../im/server/http.js';
export type { IMServerConfig as BountyServerConfig } from '../../im/server/index.js';
