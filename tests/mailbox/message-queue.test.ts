import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { MessageQueue } from '../../src/lib/mailbox/message-queue';

describe('MessageQueue', () => {
  let db: Database;
  let queue: MessageQueue;

  beforeEach(() => {
    db = new Database({ memory: true });
    queue = new MessageQueue(db);
  });

  it('should enqueue a message for external delivery', () => {
    const item = queue.enqueue({
      messageId: 'msg-123',
      externalTo: 'external@example.com',
    });

    expect(item).toBeDefined();
    expect(item.messageId).toBe('msg-123');
    expect(item.externalTo).toBe('external@example.com');
    expect(item.status).toBe('pending');
    expect(item.attempts).toBe(0);
  });

  it('should get pending items ready for delivery', () => {
    queue.enqueue({ messageId: 'msg-1', externalTo: 'a@test.com' });
    queue.enqueue({ messageId: 'msg-2', externalTo: 'b@test.com' });

    const pending = queue.getPending();
    expect(pending.length).toBe(2);
  });

  it('should mark item as sending', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    const updated = queue.markAsSending(item.id);
    
    expect(updated?.status).toBe('sending');
    expect(updated?.attempts).toBe(1);
  });

  it('should mark item as completed', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    const completed = queue.markAsCompleted(item.id);
    
    expect(completed?.status).toBe('completed');
  });

  it('should mark item as failed with error', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    const failed = queue.markAsFailed(item.id, 'Connection refused');
    
    expect(failed?.status).toBe('failed');
    expect(failed?.error).toBe('Connection refused');
  });

  it('should retry with backoff', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    queue.markAsSending(item.id);
    
    const retried = queue.scheduleRetry(item.id);
    
    expect(retried?.status).toBe('pending');
    expect(retried?.attempts).toBe(1);
    expect(retried?.nextRetryAt).toBeDefined();
    expect(retried!.nextRetryAt!).toBeGreaterThan(Date.now());
  });

  it('should not retry more than max attempts', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    // Simulate 3 attempts
    for (let i = 0; i < 3; i++) {
      queue.markAsSending(item.id);
      queue.scheduleRetry(item.id);
    }
    
    const shouldRetry = queue.shouldRetry(item.id);
    expect(shouldRetry).toBe(false);
  });

  it('should still retry within max attempts', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    // First attempt
    queue.markAsSending(item.id);
    queue.scheduleRetry(item.id);
    
    const shouldRetry = queue.shouldRetry(item.id);
    expect(shouldRetry).toBe(true);
  });

  it('should get item by ID', () => {
    const item = queue.enqueue({ messageId: 'msg-1', externalTo: 'test@test.com' });
    
    const found = queue.getById(item.id);
    
    expect(found?.messageId).toBe('msg-1');
  });

  it('should get items by message ID', () => {
    queue.enqueue({ messageId: 'msg-1', externalTo: 'a@test.com' });
    queue.enqueue({ messageId: 'msg-1', externalTo: 'b@test.com' });
    
    const items = queue.getByMessageId('msg-1');
    
    expect(items.length).toBe(2);
  });
});
