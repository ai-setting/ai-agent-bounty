/**
 * Database storage for ai-agent-bounty
 * SQLite based persistence for agents, tasks, and credits
 */

import BetterSqlite3 from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

export interface DatabaseConfig {
  path?: string;
  memory?: boolean;
}

export class Database {
  private db: BetterSqlite3.Database;

  constructor(config: DatabaseConfig = {}) {
    const { path = join(process.cwd(), 'data', 'bounty.db'), memory = false } = config;

    // Ensure data directory exists
    if (!memory) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    this.db = memory ? new BetterSqlite3(':memory:') : new BetterSqlite3(path);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize(): void {
    // Create agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        description TEXT,
        public_key TEXT,
        credits INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);

    // Create tasks table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        reward INTEGER NOT NULL,
        publisher_id TEXT NOT NULL,
        publisher_email TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        assignee_id TEXT,
        assignee_email TEXT,
        tags TEXT,
        requirements TEXT,
        deadline INTEGER,
        result TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (publisher_id) REFERENCES agents(id),
        FOREIGN KEY (assignee_id) REFERENCES agents(id)
      )
    `);

    // Create escrow table (积分托管)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS escrows (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        issuer_id TEXT NOT NULL,
        provider_id TEXT,
        amount INTEGER NOT NULL,
        status TEXT DEFAULT 'locked',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        released_at INTEGER,
        FOREIGN KEY (task_id) REFERENCES tasks(id),
        FOREIGN KEY (issuer_id) REFERENCES agents(id),
        FOREIGN KEY (provider_id) REFERENCES agents(id)
      )
    `);

    // Create mail_addresses table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS mail_addresses (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        address TEXT UNIQUE NOT NULL,
        provider TEXT DEFAULT 'internal',
        config TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);

    // Create messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        subject TEXT,
        body TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        read_at INTEGER,
        created_at INTEGER NOT NULL
      )
    `);

    // Create credit_transactions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_transactions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        amount INTEGER NOT NULL,
        type TEXT NOT NULL,
        task_id TEXT,
        description TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (task_id) REFERENCES tasks(id)
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_tasks_publisher ON tasks(publisher_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
      CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_address);
      CREATE INDEX IF NOT EXISTS idx_escrows_task ON escrows(task_id);
      CREATE INDEX IF NOT EXISTS idx_credit_transactions_agent ON credit_transactions(agent_id);
    `);
  }

  getDatabase(): BetterSqlite3.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// Re-export for backwards compatibility
export type { Database as SQLiteDatabase };
