import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database';
import type { Message, SendMessageInput } from './types';

export class MessageStore {
  constructor(private db: Database) {}

  send(input: SendMessageInput): Message {
    const id = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO mailbox_messages (id, from_address, to_address, subject, body, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'sent', ?)
    `).run(id, input.fromAddress, input.toAddress, input.subject || '', input.body, now);

    return this.getById(id)!;
  }

  getById(id: string): Message | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_messages WHERE id = ?'
    ).get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  getInbox(address: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Message[] {
    let query = 'SELECT * FROM mailbox_messages WHERE to_address = ?';
    const params: any[] = [address];

    if (options?.unreadOnly) {
      query += ' AND status != ?';
      params.push('read');
    }

    query += ' ORDER BY created_at DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
      if (options?.offset) {
        query += ' OFFSET ?';
        params.push(options.offset);
      }
    }

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapRow(row));
  }

  getUnreadCount(address: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM mailbox_messages 
      WHERE to_address = ? AND status != 'read'
    `).get(address) as any;
    return result?.count || 0;
  }

  markAsRead(id: string): boolean {
    const now = Date.now();
    const result = this.db.prepare(`
      UPDATE mailbox_messages SET status = 'read', read_at = ? WHERE id = ?
    `).run(now, id);
    return result.changes > 0;
  }

  updateStatus(id: string, status: Message['status']): boolean {
    const result = this.db.prepare(`
      UPDATE mailbox_messages SET status = ? WHERE id = ?
    `).run(status, id);
    return result.changes > 0;
  }

  delete(id: string): boolean {
    const result = this.db.prepare(
      'DELETE FROM mailbox_messages WHERE id = ?'
    ).run(id);
    return result.changes > 0;
  }

  private mapRow(row: any): Message {
    return {
      id: row.id,
      fromAddress: row.from_address,
      toAddress: row.to_address,
      subject: row.subject || undefined,
      body: row.body,
      status: row.status,
      readAt: row.read_at || undefined,
      createdAt: row.created_at,
    };
  }
}
