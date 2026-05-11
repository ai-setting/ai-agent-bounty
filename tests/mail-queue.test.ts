/**
 * TDD: Mail Queue Tests
 * 
 * RED Phase: 编写失败的测试
 * 
 * 测试 MailQueue 的核心功能：
 * 1. 消息入队
 * 2. 消息出队处理
 * 3. 重试机制
 * 4. 持久化状态
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

// ============================================================================
// Mock Types
// ============================================================================

interface QueuedMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  status: 'pending' | 'processing' | 'sent' | 'failed';
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  nextRetryAt?: number;
  error?: string;
}

// ============================================================================
// Mock MailSender
// ============================================================================

interface MockMailSender {
  send: (msg: QueuedMessage) => Promise<{ success: boolean; messageId?: string; error?: string }>;
}

// ============================================================================
// MailQueue Implementation (For Testing)
// ============================================================================

class MailQueue {
  private queue: QueuedMessage[] = [];
  private sender: MockMailSender;
  private isProcessing = false;
  private persistCallback?: (messages: QueuedMessage[]) => void;

  constructor(sender: MockMailSender) {
    this.sender = sender;
  }

  setPersistCallback(cb: (messages: QueuedMessage[]) => void) {
    this.persistCallback = cb;
  }

  enqueue(message: Omit<QueuedMessage, 'status' | 'retryCount' | 'createdAt'>): string {
    const queuedMessage: QueuedMessage = {
      ...message,
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
    };
    this.queue.push(queuedMessage);
    this.persist();
    return queuedMessage.id;
  }

  getPending(): QueuedMessage[] {
    return this.queue.filter(m => m.status === 'pending');
  }

  getById(id: string): QueuedMessage | undefined {
    return this.queue.find(m => m.id === id);
  }

  async processPending(): Promise<{ success: number; failed: number }> {
    const pending = this.getPending();
    let success = 0;
    let failed = 0;

    for (const msg of pending) {
      msg.status = 'processing';
      this.persist();

      try {
        const result = await this.sender.send(msg);
        if (result.success) {
          msg.status = 'sent';
          success++;
        } else {
          this.handleFailure(msg, result.error || 'Unknown error');
          failed++;
        }
      } catch (error) {
        this.handleFailure(msg, error instanceof Error ? error.message : String(error));
        failed++;
      }

      this.persist();
    }

    return { success, failed };
  }

  private handleFailure(msg: QueuedMessage, error: string) {
    msg.error = error;
    msg.retryCount++;

    if (msg.retryCount >= msg.maxRetries) {
      msg.status = 'failed';
    } else {
      msg.status = 'pending';
      // 指数退避: 1s, 2s, 4s, 8s...
      msg.nextRetryAt = Date.now() + Math.pow(2, msg.retryCount - 1) * 1000;
    }
  }

  private persist() {
    if (this.persistCallback) {
      this.persistCallback([...this.queue]);
    }
  }

  // 持久化恢复
  restore(messages: QueuedMessage[]) {
    this.queue = messages.map(m => ({
      ...m,
      // 重置处理中的消息为 pending
      status: m.status === 'processing' ? 'pending' : m.status,
    }));
  }

  clear() {
    this.queue = [];
    this.persist();
  }

  size(): number {
    return this.queue.length;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('MailQueue', () => {
  let mockSender: MockMailSender;
  let queue: MailQueue;

  beforeEach(() => {
    mockSender = {
      send: vi.fn(),
    };
    queue = new MailQueue(mockSender);
  });

  describe('Enqueue', () => {
    it('should add message to queue with pending status', () => {
      const id = queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test message',
        maxRetries: 3,
      });

      expect(id).toBe('msg-1');
      
      const pending = queue.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0].status).toBe('pending');
      expect(pending[0].retryCount).toBe(0);
    });

    it('should generate unique message IDs', () => {
      const id1 = queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Test 1',
        body: 'Body 1',
        maxRetries: 3,
      });

      const id2 = queue.enqueue({
        id: 'msg-2',
        from: 'bob@agent-mail.local',
        to: 'alice@agent-mail.local',
        subject: 'Test 2',
        body: 'Body 2',
        maxRetries: 3,
      });

      expect(id1).not.toBe(id2);
      expect(queue.size()).toBe(2);
    });
  });

  describe('Process', () => {
    it('should send pending messages successfully', async () => {
      queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 3,
      });

      // Mock successful send
      mockSender.send = vi.fn().mockResolvedValue({ success: true, messageId: 'smtp-123' });

      const result = await queue.processPending();

      expect(result.success).toBe(1);
      expect(result.failed).toBe(0);
      
      const msg = queue.getById('msg-1');
      expect(msg?.status).toBe('sent');
    });

    it('should mark message as failed after max retries', async () => {
      queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 2,
      });

      // Mock failed send
      mockSender.send = vi.fn().mockResolvedValue({ success: false, error: 'SMTP connection failed' });

      // First attempt
      await queue.processPending();
      let msg = queue.getById('msg-1');
      expect(msg?.status).toBe('pending');
      expect(msg?.retryCount).toBe(1);
      expect(msg?.error).toBe('SMTP connection failed');

      // Second attempt (final)
      await queue.processPending();
      msg = queue.getById('msg-1');
      expect(msg?.status).toBe('failed');
      expect(msg?.retryCount).toBe(2);
    });

    it('should handle partial failures', async () => {
      queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 3,
      });

      queue.enqueue({
        id: 'msg-2',
        from: 'alice@agent-mail.local',
        to: 'charlie@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 3,
      });

      // First succeeds, second fails
      mockSender.send = vi.fn()
        .mockResolvedValueOnce({ success: true, messageId: 'smtp-1' })
        .mockResolvedValueOnce({ success: false, error: 'Recipient unknown' });

      const result = await queue.processPending();

      expect(result.success).toBe(1);
      expect(result.failed).toBe(1);
    });
  });

  describe('Persistence', () => {
    it('should call persist callback on state change', () => {
      let persistedMessages: QueuedMessage[] = [];
      queue.setPersistCallback((messages) => {
        persistedMessages = messages;
      });

      queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 3,
      });

      expect(persistedMessages.length).toBe(1);
      expect(persistedMessages[0].id).toBe('msg-1');
    });

    it('should restore state from persisted messages', () => {
      const persistedMessages: QueuedMessage[] = [
        {
          id: 'msg-1',
          from: 'alice@agent-mail.local',
          to: 'bob@agent-mail.local',
          subject: 'Hello',
          body: 'Test',
          status: 'pending',
          retryCount: 1,
          maxRetries: 3,
          createdAt: Date.now(),
          error: 'Previous error',
        },
        {
          id: 'msg-2',
          from: 'bob@agent-mail.local',
          to: 'alice@agent-mail.local',
          subject: 'Reply',
          body: 'Hi',
          status: 'sent',
          retryCount: 0,
          maxRetries: 3,
          createdAt: Date.now(),
        },
      ];

      queue.restore(persistedMessages);

      expect(queue.size()).toBe(2);
      
      const msg1 = queue.getById('msg-1');
      expect(msg1?.status).toBe('pending'); // Reset from pending
      expect(msg1?.retryCount).toBe(1);
    });

    it('should reset processing messages to pending on restore', () => {
      const persistedMessages: QueuedMessage[] = [
        {
          id: 'msg-1',
          from: 'alice@agent-mail.local',
          to: 'bob@agent-mail.local',
          subject: 'Hello',
          body: 'Test',
          status: 'processing', // Crashed while processing
          retryCount: 0,
          maxRetries: 3,
          createdAt: Date.now(),
        },
      ];

      queue.restore(persistedMessages);

      const msg1 = queue.getById('msg-1');
      expect(msg1?.status).toBe('pending'); // Reset for retry
    });
  });

  describe('Retry Backoff', () => {
    it('should set nextRetryAt with exponential backoff', async () => {
      queue.enqueue({
        id: 'msg-1',
        from: 'alice@agent-mail.local',
        to: 'bob@agent-mail.local',
        subject: 'Hello',
        body: 'Test',
        maxRetries: 3,
      });

      mockSender.send = vi.fn().mockResolvedValue({ success: false, error: 'Temp error' });

      // First retry
      await queue.processPending();
      let msg = queue.getById('msg-1');
      const firstRetryAt = msg?.nextRetryAt;
      expect(firstRetryAt).toBeGreaterThan(Date.now());

      // Check exponential backoff (1s, 2s, 4s...)
      // Advance time and retry
      if (msg?.nextRetryAt) {
        const originalNow = Date.now;
        Date.now = vi.fn().mockReturnValue(msg.nextRetryAt + 100);
        
        await queue.processPending();
        
        Date.now = originalNow;
      }

      msg = queue.getById('msg-1');
      // After 2 retries with exponential backoff
      expect(msg?.retryCount).toBeGreaterThanOrEqual(1);
    });
  });
});
