/**
 * Bounty Server WebSocket Module
 * 
 * Provides WebSocket server for:
 * - Auth: Authentication and agent management
 * - Bounty: Task publishing, grabbing, completion
 * - IM: Real-time agent messaging
 */

export { IMWebSocketServer as BountyWebSocketServer } from '../../im/server/ws.js';
