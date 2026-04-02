/**
 * Database storage for ai-agent-bounty
 * SQLite based persistence using Bun's built-in bun:sqlite module
 */

import { join } from "path";
import { existsSync, mkdirSync } from "fs";

export interface DatabaseConfig {
  path?: string;
  memory?: boolean;
}

// Use Bun's built-in sqlite
import { Database as BunDatabase } from "bun:sqlite";

/**
 * Prepared statement wrapper for bun:sqlite
 * Mimics better-sqlite3's PreparedStatement interface
 */
class PreparedStatement {
  private db: any;
  private sql: string;

  constructor(db: any, sql: string) {
    this.db = db;
    this.sql = sql;
  }

  get(...params: any[]): any {
    return this.db.prepare(this.sql).get(...params);
  }

  all(...params: any[]): any[] {
    return this.db.prepare(this.sql).all(...params);
  }

  run(...params: any[]): any {
    return this.db.prepare(this.sql).run(...params);
  }
}

export class Database {
  private db: any;

  constructor(config: DatabaseConfig = {}) {
    const { 
      path = join(process.cwd(), 'data', 'bounty.db'), 
      memory = false 
    } = config;

    // Ensure data directory exists
    if (!memory) {
      const dir = path.substring(0, path.lastIndexOf('/'));
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }

    const dbPath = memory ? ":memory:" : path;
    this.db = new BunDatabase(dbPath);
    this.initialize();
  }

  private initialize(): void {
    // Create agents table
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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
    this.db.run(`
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

    // Create agent_configs table (SMTP/IMAP configuration per agent)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS agent_configs (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL UNIQUE,
        smtp_host TEXT,
        smtp_port INTEGER DEFAULT 587,
        smtp_user TEXT,
        smtp_password TEXT,
        smtp_secure INTEGER DEFAULT 0,
        imap_host TEXT,
        imap_port INTEGER DEFAULT 993,
        imap_user TEXT,
        imap_password TEXT,
        imap_tls INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id)
      )
    `);

    // Create mail_channels table (通信通道)
    this.db.run(`
      CREATE TABLE IF NOT EXISTS mail_channels (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        address TEXT NOT NULL,
        status TEXT DEFAULT 'disconnected',
        last_checked_at INTEGER,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id),
        FOREIGN KEY (address) REFERENCES mail_addresses(address)
      )
    `);

    // Create indexes
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_publisher ON tasks(publisher_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_messages_to ON messages(to_address)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_escrows_task ON escrows(task_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_credit_transactions_agent ON credit_transactions(agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_agent_configs_agent ON agent_configs(agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mail_channels_agent ON mail_channels(agent_id)`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_mail_channels_address ON mail_channels(address)`);
  }

  /**
   * Prepare a SQL statement
   * Returns a PreparedStatement with get(), all(), run() methods
   */
  prepare(sql: string): PreparedStatement {
    return new PreparedStatement(this.db, sql);
  }

  /**
   * Execute raw SQL without parameters
   */
  exec(sql: string): void {
    this.db.exec(sql);
  }

  /**
   * Get the underlying database instance
   */
  getDatabase(): any {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

// Re-export for backwards compatibility
export type { Database as SQLiteDatabase };
