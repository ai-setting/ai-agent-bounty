/**
 * Bounty Server
 * 
 * Single server module providing:
 * - HTTP REST API (Auth, Agents, Tasks, Messages)
 * - WebSocket (real-time messaging)
 */

export { BountyHTTPServer } from './http/index.js';
export type { BountyServerConfig } from './http/index.js';
