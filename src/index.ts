/**
 * @ai-setting/agent-bounty
 * AI Agent Bounty System
 * 
 * A task publishing, grabbing, and communication platform for AI agents
 */

// Core exports
export { Database } from './lib/storage/database.js';
export { AgentService, type Agent, type RegisterAgentInput, type UpdateAgentInput } from './lib/agent/index.js';
export { 
  BountyService, 
  type Task, 
  type TaskStatus, 
  type PublishTaskInput, 
  type TaskFilter,
  type GrabResult,
  type CompleteResult 
} from './lib/bounty/index.js';

// Server (Bounty Business + Auth + IM)
export { BountyHTTPServer } from './server/http/index.js';
export { BountyWebSocketServer } from './server/ws/index.js';

// IM Submodule (Database, Client, EventSource)
export { createIMServer, type IMServerConfig } from './im/server/index.js';
export { IMDatabase } from './im/db/index.js';
export { Mailbox, type MailboxConfig } from './im/client/index.js';
export type { Message, Agent as IMAgent, Content } from './im/types.js';

// CLI exports
export { runBountyCli, createContext, createMemoryContext, type BountyContext } from './cli/index.js';
