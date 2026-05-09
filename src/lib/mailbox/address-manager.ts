import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database';
import type { MailAddress } from './types';

export class AddressManager {
  constructor(private db: Database, private domain = 'local') {}

  register(agentId: string, name: string, customAddress?: string): MailAddress {
    // Check if already registered
    const existing = this.getByAgentId(agentId);
    if (existing) {
      throw new Error(`Agent ${agentId} already has address: ${existing.address}`);
    }

    const id = uuidv4();
    const address = customAddress || this.generateAddress(name);
    const now = Date.now();

    // Check if address already exists
    const existingAddr = this.getByEmail(address);
    if (existingAddr) {
      throw new Error(`Address ${address} already exists`);
    }

    this.db.prepare(`
      INSERT INTO mailbox_addresses (id, agent_id, address, type, created_at)
      VALUES (?, ?, ?, 'internal', ?)
    `).run(id, agentId, address, now);

    return this.getById(id)!;
  }

  private generateAddress(name: string): string {
    const sanitized = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
    return `${sanitized}@${this.domain}`;
  }

  getById(id: string): MailAddress | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_addresses WHERE id = ?'
    ).get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  getByAgentId(agentId: string): MailAddress | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_addresses WHERE agent_id = ?'
    ).get(agentId) as any;
    return row ? this.mapRow(row) : null;
  }

  getByEmail(address: string): MailAddress | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_addresses WHERE address = ?'
    ).get(address) as any;
    return row ? this.mapRow(row) : null;
  }

  list(): MailAddress[] {
    const rows = this.db.prepare(
      'SELECT * FROM mailbox_addresses ORDER BY created_at DESC'
    ).all() as any[];
    return rows.map(row => this.mapRow(row));
  }

  delete(agentId: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM mailbox_addresses WHERE agent_id = ?'
    ).run(agentId);
    return result.changes > 0;
  }

  private mapRow(row: any): MailAddress {
    return {
      id: row.id,
      agentId: row.agent_id,
      address: row.address,
      type: row.type,
      createdAt: row.created_at,
    };
  }
}
