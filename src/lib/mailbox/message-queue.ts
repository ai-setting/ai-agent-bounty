import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database';
import type { OutboundQueueItem } from './types';

const MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 30000; // 30 seconds

export interface EnqueueInput {
  messageId: string;
  externalTo: string;
}

export class MessageQueue {
  constructor(private db: Database) {}

  enqueue(input: EnqueueInput): OutboundQueueItem {
    const id = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO mailbox_outbound_queue (id, message_id, external_to, attempts, status, created_at)
      VALUES (?, ?, ?, 0, 'pending', ?)
    `).run(id, input.messageId, input.externalTo, now);

    return this.getById(id)!;
  }

  getById(id: string): OutboundQueueItem | null {
    const row = this.db.prepare(
      'SELECT * FROM mailbox_outbound_queue WHERE id = ?'
    ).get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  getByMessageId(messageId: string): OutboundQueueItem[] {
    const rows = this.db.prepare(
      'SELECT * FROM mailbox_outbound_queue WHERE message_id = ?'
    ).all(messageId) as any[];
    return rows.map(row => this.mapRow(row));
  }

  getPending(): OutboundQueueItem[] {
    const now = Date.now();
    const rows = this.db.prepare(`
      SELECT * FROM mailbox_outbound_queue 
      WHERE status = 'pending' 
        AND (next_retry_at IS NULL OR next_retry_at <= ?)
      ORDER BY created_at ASC
    `).all(now) as any[];
    return rows.map(row => this.mapRow(row));
  }

  markAsSending(id: string): OutboundQueueItem | null {
    const row = this.db.prepare(
      'SELECT attempts FROM mailbox_outbound_queue WHERE id = ?'
    ).get(id) as any;
    if (!row) return null;

    this.db.prepare(`
      UPDATE mailbox_outbound_queue 
      SET status = 'sending', attempts = attempts + 1 
      WHERE id = ?
    `).run(id);

    return this.getById(id);
  }

  markAsCompleted(id: string): OutboundQueueItem | null {
    this.db.prepare(`
      UPDATE mailbox_outbound_queue SET status = 'completed' WHERE id = ?
    `).run(id);
    return this.getById(id);
  }

  markAsFailed(id: string, error: string): OutboundQueueItem | null {
    this.db.prepare(`
      UPDATE mailbox_outbound_queue SET status = 'failed', error = ? WHERE id = ?
    `).run(error, id);
    return this.getById(id);
  }

  scheduleRetry(id: string): OutboundQueueItem | null {
    const item = this.getById(id);
    if (!item) return null;

    const nextRetryAt = Date.now() + RETRY_INTERVAL_MS;
    this.db.prepare(`
      UPDATE mailbox_outbound_queue 
      SET status = 'pending', next_retry_at = ? 
      WHERE id = ?
    `).run(nextRetryAt, id);

    return this.getById(id);
  }

  shouldRetry(id: string): boolean {
    const item = this.getById(id);
    if (!item) return false;
    return item.attempts < MAX_ATTEMPTS;
  }

  private mapRow(row: any): OutboundQueueItem {
    return {
      id: row.id,
      messageId: row.message_id,
      externalTo: row.external_to,
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at || undefined,
      status: row.status,
      error: row.error || undefined,
      createdAt: row.created_at,
    };
  }
}
