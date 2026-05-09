import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database';
import type { Channel } from './types';

export class ChannelManager {
  constructor(private db: Database) {}

  register(agentId: string, type: 'websocket' | 'http'): Channel {
    const id = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO mailbox_channels (id, agent_id, type, status, last_heartbeat, created_at)
      VALUES (?, ?, ?, 'connected', ?, ?)
    `).run(id, agentId, type, now, now);

    return this.getById(id)!;
  }

  getById(id: string): Channel | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_channels WHERE id = ?'
    ).get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  getByAgentId(agentId: string): Channel[] {
    const rows = this.db.prepare(
      'SELECT * FROM mailbox_channels WHERE agent_id = ?'
    ).all(agentId) as any[];
    return rows.map(row => this.mapRow(row));
  }

  getConnectedChannels(agentId: string): Channel[] {
    const rows = this.db.prepare(
      'SELECT * FROM mailbox_channels WHERE agent_id = ? AND status = ?'
    ).all(agentId, 'connected') as any[];
    return rows.map(row => this.mapRow(row));
  }

  updateHeartbeat(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE mailbox_channels SET last_heartbeat = ? WHERE id = ?
    `).run(Date.now(), id);
    return result.changes > 0;
  }

  disconnect(id: string): boolean {
    const result = this.db.prepare(`
      UPDATE mailbox_channels SET status = 'disconnected' WHERE id = ?
    `).run(id);
    return result.changes > 0;
  }

  cleanupStale(maxIdleTime: number): number {
    const cutoff = Date.now() - maxIdleTime;
    const result = this.db.prepare(`
      UPDATE mailbox_channels SET status = 'disconnected' 
      WHERE status = 'connected' AND last_heartbeat < ?
    `).run(cutoff);
    return result.changes;
  }

  private mapRow(row: any): Channel {
    return {
      id: row.id,
      agentId: row.agent_id,
      type: row.type,
      status: row.status,
      lastHeartbeat: row.last_heartbeat,
      createdAt: row.created_at,
    };
  }
}
