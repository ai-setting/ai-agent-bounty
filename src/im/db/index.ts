import { Database as BunDatabase } from 'bun:sqlite';
import type { Message, Agent, MessageStatus, AgentStatus } from '../types';

export interface IMDatabaseConfig {
  path?: string;
  memory?: boolean;
}

interface MessageRow {
  id: string;
  from_address: string;
  to_address: string;
  content: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
}

interface AgentRow {
  id: string;
  host: string;
  address: string;
  name: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
}

export class IMDatabase {
  private db: BunDatabase;

  constructor(config: IMDatabaseConfig = {}) {
    const path = config.memory ? ':memory:' : (config.path || './data/im.db');
    this.db = new BunDatabase(path);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS im_messages (
        id TEXT PRIMARY KEY,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS im_agents (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        address TEXT UNIQUE NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'offline',
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_messages_to ON im_messages(to_address)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_messages_status ON im_messages(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_agents_address ON im_agents(address)`);
  }

  // Message operations
  saveMessage(message: Message): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO im_messages 
      (id, from_address, to_address, content, status, created_at, delivered_at, acked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.from,
      message.to,
      JSON.stringify(message.content),
      message.status,
      message.createdAt,
      message.deliveredAt || null,
      message.ackedAt || null
    );
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM im_messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  getInbox(address: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM im_messages WHERE to_address = ? ORDER BY created_at DESC'
    ).all(address) as MessageRow[];
    return rows.map(row => this.rowToMessage(row));
  }

  /**
   * Get pending messages for an address
   * Only returns messages with status 'pending' - not yet delivered
   * Does NOT return 'delivered' messages to avoid duplicate delivery on reconnect
   */
  getPendingMessages(address: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM im_messages WHERE to_address = ? AND status = ? ORDER BY created_at ASC'
    ).all(address, 'pending') as MessageRow[];
    return rows.map(row => this.rowToMessage(row));
  }

  updateMessageStatus(id: string, status: MessageStatus): void {
    const now = new Date().toISOString();

    if (status === 'delivered') {
      this.db.prepare('UPDATE im_messages SET status = ?, delivered_at = ? WHERE id = ?').run(status, now, id);
    } else if (status === 'acked') {
      this.db.prepare('UPDATE im_messages SET status = ?, acked_at = ? WHERE id = ?').run(status, now, id);
    } else {
      this.db.prepare('UPDATE im_messages SET status = ? WHERE id = ?').run(status, id);
    }
  }

  // Agent operations
  saveAgent(agent: Agent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO im_agents 
      (id, host, address, name, status, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.host,
      agent.address,
      agent.name || null,
      agent.status,
      agent.lastSeenAt,
      agent.createdAt
    );
  }

  getAgentById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM im_agents WHERE id = ?').get(id) as AgentRow | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  getAgentByAddress(address: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM im_agents WHERE address = ?').get(address) as AgentRow | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE im_agents SET status = ?, last_seen_at = ? WHERE id = ?').run(status, now, id);
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      from: row.from_address,
      to: row.to_address,
      content: JSON.parse(row.content),
      status: row.status as MessageStatus,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || undefined,
      ackedAt: row.acked_at || undefined,
    };
  }

  private rowToAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      host: row.host,
      address: row.address,
      name: row.name || undefined,
      status: row.status as AgentStatus,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
