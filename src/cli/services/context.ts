/**
 * Bounty Context - Service Container
 *
 * Provides access to all services needed by CLI commands
 *
 * Phase feat/bounty-task-optimize:
 * - dbPath 从硬编码 `./data/bounty.db` 改为读 `bountyConfig.dbPath`
 *   → 让 BOUNTY_DB_PATH env 生效（与 BOUNTY_API_URL 等 env 一致）
 *   → 与 com send / inbox 一致的 "config-first, env-override" 体验
 */

import { Database } from '../../lib/storage/database.js';
import { AgentService } from '../../lib/agent/index.js';
import { BountyService } from '../../lib/bounty/index.js';
import { IMDatabase } from '../../im/db/index.js';
import { bountyConfig } from '../../lib/config/bounty-config.js';

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
  imDb: IMDatabase;
}

/**
 * Create a new BountyContext with all services initialized
 *
 * Database path 来源: bountyConfig.dbPath (默认 './data/bounty.db'，
 * 可通过 BOUNTY_DB_PATH 环境变量覆盖)
 */
export function createContext(): BountyContext {
  const dbPath = bountyConfig.dbPath;
  const db = new Database({ path: dbPath });
  const agentService = new AgentService(db);
  const bountyService = new BountyService(db, agentService);
  const imDb = new IMDatabase({ path: dbPath });

  return {
    db,
    agentService,
    bountyService,
    imDb,
  };
}

/**
 * Create a new BountyContext with in-memory database (for testing)
 */
export function createMemoryContext(): BountyContext {
  const db = new Database({ memory: true });
  const agentService = new AgentService(db);
  const bountyService = new BountyService(db, agentService);
  const imDb = new IMDatabase({ memory: true });

  return {
    db,
    agentService,
    bountyService,
    imDb,
  };
}