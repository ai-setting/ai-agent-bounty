/**
 * @fileoverview MailQueue - 邮件发送队列
 * 
 * 提供消息队列功能：
 * - 消息入队和持久化
 * - 自动重试机制（指数退避）
 * - 崩溃恢复
 * 
 * TDD 驱动开发
 */

import { randomUUID } from 'crypto';

/**
 * 队列消息状态
 */
export type QueueMessageStatus = 'pending' | 'processing' | 'sent' | 'failed';

/**
 * 队列消息接口
 */
export interface QueueMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  status: QueueMessageStatus;
  retryCount: number;
  maxRetries: number;
  createdAt: number;
  nextRetryAt?: number;
  error?: string;
  smtpMessageId?: string;  // SMTP 返回的 Message-ID
}

/**
 * 邮件发送器接口
 */
export interface MailSender {
  send(msg: QueueMessage): Promise<{
    success: boolean;
    messageId?: string;
    error?: string;
  }>;
}

/**
 * 持久化回调
 */
export type PersistCallback = (messages: QueueMessage[]) => void;

/**
 * MailQueue 配置
 */
export interface MailQueueConfig {
  /** 最大重试次数 */
  maxRetries?: number;
  /** 基础重试延迟（毫秒） */
  baseRetryDelay?: number;
  /** 最大重试延迟（毫秒） */
  maxRetryDelay?: number;
}

/**
 * MailQueue - 邮件发送队列
 * 
 * 特性：
 * - FIFO 队列
 * - 指数退避重试
 * - 崩溃恢复支持
 * - 持久化回调
 */
export class MailQueue {
  private queue: QueueMessage[] = [];
  private sender: MailSender;
  private config: Required<MailQueueConfig>;
  private persistCallback?: PersistCallback;

  constructor(sender: MailSender, config: MailQueueConfig = {}) {
    this.sender = sender;
    this.config = {
      maxRetries: config.maxRetries ?? 3,
      baseRetryDelay: config.baseRetryDelay ?? 1000,
      maxRetryDelay: config.maxRetryDelay ?? 60000,
    };
  }

  /**
   * 设置持久化回调
   */
  setPersistCallback(cb: PersistCallback): void {
    this.persistCallback = cb;
  }

  /**
   * 入队消息
   */
  enqueue(message: Omit<QueueMessage, 'id' | 'status' | 'retryCount' | 'createdAt'> & { id?: string }): string {
    const queuedMessage: QueueMessage = {
      ...message,
      id: message.id ?? randomUUID(),
      status: 'pending',
      retryCount: 0,
      createdAt: Date.now(),
    };
    this.queue.push(queuedMessage);
    this.persist();
    return queuedMessage.id;
  }

  /**
   * 获取待处理消息
   */
  getPending(): QueueMessage[] {
    return this.queue.filter(m => m.status === 'pending');
  }

  /**
   * 获取所有消息
   */
  getAll(): QueueMessage[] {
    return [...this.queue];
  }

  /**
   * 根据 ID 获取消息
   */
  getById(id: string): QueueMessage | undefined {
    return this.queue.find(m => m.id === id);
  }

  /**
   * 获取消息统计
   */
  getStats(): { pending: number; processing: number; sent: number; failed: number } {
    return {
      pending: this.queue.filter(m => m.status === 'pending').length,
      processing: this.queue.filter(m => m.status === 'processing').length,
      sent: this.queue.filter(m => m.status === 'sent').length,
      failed: this.queue.filter(m => m.status === 'failed').length,
    };
  }

  /**
   * 处理待发送消息
   */
  async processPending(): Promise<{ success: number; failed: number; retried: number }> {
    // 获取可处理的消息（pending 且未到重试时间）
    const pending = this.queue.filter(m => 
      m.status === 'pending' && 
      (m.nextRetryAt === undefined || m.nextRetryAt <= Date.now())
    );

    let success = 0;
    let failed = 0;
    let retried = 0;

    for (const msg of pending) {
      msg.status = 'processing';
      this.persist();

      let sendSuccess = false;
      let sendError: string | undefined;

      try {
        const result = await this.sender.send(msg);
        sendSuccess = result.success;
        sendError = result.error;
      } catch (err) {
        sendError = err instanceof Error ? err.message : String(err);
      }

      if (sendSuccess) {
        msg.status = 'sent';
        msg.smtpMessageId = (msg as any).smtpMessageId;
        success++;
      } else {
        const willRetry = this.handleFailure(msg, sendError || 'Unknown error');
        if (willRetry) {
          retried++;
        } else {
          failed++;
        }
      }

      this.persist();
    }

    return { success, failed, retried };
  }

  /**
   * 处理失败消息
   * @returns true if will retry, false if max retries exceeded
   */
  private handleFailure(msg: QueueMessage, error: string): boolean {
    msg.error = error;
    msg.retryCount++;

    if (msg.retryCount >= msg.maxRetries) {
      msg.status = 'failed';
      msg.nextRetryAt = undefined;
      return false;
    } else {
      msg.status = 'pending';
      // 指数退避: baseDelay * 2^(retryCount-1)
      const delay = Math.min(
        this.config.baseRetryDelay * Math.pow(2, msg.retryCount - 1),
        this.config.maxRetryDelay
      );
      msg.nextRetryAt = Date.now() + delay;
      return true;
    }
  }

  /**
   * 重置失败消息到 pending（手动重试）
   */
  retry(id: string): boolean {
    const msg = this.getById(id);
    if (!msg || msg.status !== 'failed') {
      return false;
    }
    msg.status = 'pending';
    msg.retryCount = 0;
    msg.nextRetryAt = undefined;
    msg.error = undefined;
    this.persist();
    return true;
  }

  /**
   * 从持久化恢复
   */
  restore(messages: QueueMessage[]): void {
    this.queue = messages.map(m => ({
      ...m,
      // 崩溃恢复：将 processing 重置为 pending
      status: m.status === 'processing' ? 'pending' : m.status,
    }));
  }

  /**
   * 清理已发送消息（保留 N 条）
   */
  cleanup(keepLast: number = 100): number {
    const sent = this.queue.filter(m => m.status === 'sent');
    const toRemove = sent.slice(0, Math.max(0, sent.length - keepLast));
    
    for (const msg of toRemove) {
      const index = this.queue.indexOf(msg);
      if (index !== -1) {
        this.queue.splice(index, 1);
      }
    }

    if (toRemove.length > 0) {
      this.persist();
    }

    return toRemove.length;
  }

  /**
   * 清空队列
   */
  clear(): void {
    this.queue = [];
    this.persist();
  }

  /**
   * 获取队列大小
   */
  size(): number {
    return this.queue.length;
  }

  /**
   * 持久化
   */
  private persist(): void {
    if (this.persistCallback) {
      this.persistCallback([...this.queue]);
    }
  }
}
