/**
 * Bounty Context - Service Container
 * 
 * Provides access to all services needed by CLI commands
 */

import { Database } from '../../lib/storage/database.js';
import { AgentService } from '../../lib/agent/index.js';
import { BountyService } from '../../lib/bounty/index.js';
import { MailService } from '../../lib/mail/index.js';

/**
 * BountyContext - Service container interface
 * 
 * Holds references to all services used by CLI commands.
 * This follows the dependency injection pattern for better testability.
 */
export interface BountyContext {
  db: Database;
  agentService: AgentService;
  bountyService: BountyService;
  mailService: MailService;
}

/**
 * Create a new BountyContext with all services initialized
 */
export function createContext(): BountyContext {
  const db = new Database({ path: './data/bounty.db' });
  const agentService = new AgentService(db);
  const bountyService = new BountyService(db, agentService);
  const mailService = new MailService(db);

  return {
    db,
    agentService,
    bountyService,
    mailService,
  };
}

/**
 * Create a new BountyContext with in-memory database (for testing)
 */
export function createMemoryContext(): BountyContext {
  const db = new Database({ memory: true });
  const agentService = new AgentService(db);
  const bountyService = new BountyService(db, agentService);
  const mailService = new MailService(db);

  return {
    db,
    agentService,
    bountyService,
    mailService,
  };
}
