import { Database } from '../storage/database';
import { MessageStore } from './message-store';
import { AddressManager } from './address-manager';
import { MessageQueue } from './message-queue';
import { EventBus, EventType } from './event-bus';
import type { MailboxConfig } from './config';
import type { Message } from './types';

export interface SmtpGatewayConfig {
  db: Database;
  messageStore: MessageStore;
  addressManager: AddressManager;
  eventBus: EventBus;
  config: MailboxConfig;
}

export interface InboundEmailInput {
  from: string;
  to: string;
  subject?: string;
  body: string;
}

/**
 * SmtpGateway handles both inbound and outbound SMTP email processing.
 * 
 * Inbound: Receives emails from external sources and delivers them to local mailboxes
 * Outbound: Queues local messages for delivery to external email addresses
 */
export class SmtpGateway {
  private messageQueue: MessageQueue;
  private queueProcessorInterval?: ReturnType<typeof setInterval>;

  constructor(private deps: SmtpGatewayConfig) {
    this.messageQueue = new MessageQueue(deps.db);
  }

  /**
   * Process inbound email from external source
   */
  async queueInboundEmail(input: InboundEmailInput): Promise<void> {
    const { addressManager, messageStore, eventBus } = this.deps;
    const localDomain = this.deps.config.domain;

    // Check if destination is local
    const isLocal = input.to.endsWith(`@${localDomain}`);
    
    if (isLocal) {
      // Verify local address exists
      const address = addressManager.getByEmail(input.to);
      if (!address) {
        throw new Error(`Address not found: ${input.to}`);
      }

      // Store message locally
      const msg = messageStore.send({
        fromAddress: input.from,
        toAddress: input.to,
        subject: input.subject,
        body: input.body,
      });

      // Emit received event
      eventBus.emit(EventType.MESSAGE_RECEIVED, {
        messageId: msg.id,
        fromAddress: input.from,
        toAddress: input.to,
      });
    } else {
      // Forward to external - this shouldn't happen for inbound
      throw new Error(`Invalid local destination: ${input.to}`);
    }
  }

  /**
   * Queue a message for outbound delivery to external address
   */
  async queueOutboundEmail(messageId: string): Promise<void> {
    const { messageStore, addressManager } = this.deps;
    const localDomain = this.deps.config.domain;

    // Get the message
    const message = messageStore.getById(messageId);
    if (!message) {
      throw new Error(`Message not found: ${messageId}`);
    }

    // Check if destination is external (not local domain)
    const isExternal = !message.toAddress.endsWith(`@${localDomain}`);
    
    if (!isExternal) {
      // Internal delivery - no need for SMTP
      return;
    }

    // Enqueue for outbound delivery
    this.messageQueue.enqueue({
      messageId: message.id,
      externalTo: message.toAddress,
    });
  }

  /**
   * Get pending delivery items
   */
  getPendingDeliveries() {
    return this.messageQueue.getPending();
  }

  /**
   * Get all queue items (for debugging/monitoring)
   */
  getAllQueueItems() {
    const items = this.messageQueue.getPending();
    
    // Also get non-pending items by querying directly
    const rows = this.deps.db.prepare(`
      SELECT * FROM mailbox_outbound_queue 
      WHERE status != 'completed'
      ORDER BY created_at DESC
    `).all() as any[];
    
    return rows.map((row: any) => ({
      id: row.id,
      messageId: row.message_id,
      externalTo: row.external_to,
      attempts: row.attempts,
      nextRetryAt: row.next_retry_at || undefined,
      status: row.status,
      error: row.error || undefined,
      createdAt: row.created_at,
    }));
  }

  /**
   * Mark a delivery as completed
   */
  async markDeliveryCompleted(queueItemId: string): Promise<void> {
    this.messageQueue.markAsCompleted(queueItemId);
  }

  /**
   * Mark a delivery as failed
   */
  async markDeliveryFailed(queueItemId: string, error: string): Promise<void> {
    const { eventBus } = this.deps;
    
    // Mark as sending (increments attempt count)
    this.messageQueue.markAsSending(queueItemId);
    
    // Check if we should retry
    const shouldRetryNow = this.messageQueue.shouldRetry(queueItemId);
    
    if (shouldRetryNow) {
      // Schedule for retry with backoff
      this.messageQueue.scheduleRetry(queueItemId);
    } else {
      // Permanent failure
      this.messageQueue.markAsFailed(queueItemId, error);
      
      // Emit failure event
      const item = this.messageQueue.getById(queueItemId);
      if (item) {
        eventBus.emit(EventType.MESSAGE_FAILED, {
          messageId: item.messageId,
          error,
        });
      }
    }
  }

  /**
   * Start the queue processor (for automatic delivery attempts)
   */
  startQueueProcessor(): void {
    if (this.queueProcessorInterval) return;

    const { config } = this.deps;
    
    this.queueProcessorInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('Queue processing error:', err);
      });
    }, config.smtpQueueInterval);
  }

  /**
   * Stop the queue processor
   */
  stopQueueProcessor(): void {
    if (this.queueProcessorInterval) {
      clearInterval(this.queueProcessorInterval);
      this.queueProcessorInterval = undefined;
    }
  }

  /**
   * Process pending items in the queue
   * In a real implementation, this would connect to external SMTP servers
   */
  private async processQueue(): Promise<void> {
    const pending = this.messageQueue.getPending();
    
    for (const item of pending) {
      // Mark as sending
      this.messageQueue.markAsSending(item.id);

      // In a real implementation, this would:
      // 1. Connect to external SMTP server
      // 2. Send the email
      // 3. Handle success/failure responses
      
      // For now, we simulate successful delivery
      try {
        // Simulate SMTP send
        await this.simulateSend(item.externalTo);
        this.messageQueue.markAsCompleted(item.id);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        await this.markDeliveryFailed(item.id, errorMsg);
      }
    }
  }

  /**
   * Simulate SMTP send (placeholder for real implementation)
   */
  private async simulateSend(to: string): Promise<void> {
    // In production, this would:
    // 1. Look up MX records for the domain
    // 2. Connect to the mail server
    // 3. Send via SMTP protocol
    
    // For now, just validate the email format
    if (!to.includes('@')) {
      throw new Error('Invalid email address');
    }
  }

  /**
   * Stop the gateway
   */
  stop(): void {
    this.stopQueueProcessor();
  }
}
