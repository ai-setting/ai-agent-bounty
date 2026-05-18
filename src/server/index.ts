/**
 * Bounty Server
 * 
 * Core server module providing:
 * - Auth: Authentication and agent management
 * - Bounty: Task publishing, grabbing, completion
 * - IM: Agent messaging
 */

export { BountyHTTPServer } from './http/index.js';
export { BountyWebSocketServer } from './ws/index.js';
export type { BountyServerConfig } from './http/index.js';
