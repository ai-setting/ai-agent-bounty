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
export { 
  MailService, 
  type MailAddress, 
  type Message, 
  type SendMessageInput,
  type MailConfig 
} from './lib/mail/index.js';

// Tools exports
export { createBountyTools, type ToolsContext } from './tools/index.js';
