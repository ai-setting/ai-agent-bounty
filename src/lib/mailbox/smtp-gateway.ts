import nodemailer from 'nodemailer';
import { Database } from '../storage/database';
import { MessageStore } from './message-store';
import { AddressManager } from './address-manager';
import { MessageQueue } from './message-queue';
import { EventBus, EventType } from './event-bus';
import type { MailboxConfig, SmtpOutboundConfig } from './config';

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
 *          via configured SMTP server (e.g., gddzhaokun@163.com)
 */
export class SmtpGateway {
  private messageQueue: MessageQueue;
  private queueProcessorInterval?: ReturnType<typeof setInterval>;
  private transporter?: nodemailer.Transporter;

  constructor(private deps: SmtpGatewayConfig) {
    this.messageQueue = new MessageQueue(deps.db);
    this.initTransporter();
  }

  /**
   * Initialize nodemailer transporter from config
   */
  private initTransporter(): void {
    const smtpConfig = this.deps.config.smtpOutbound;
    
    if (!smtpConfig) {
      console.log('[SmtpGateway] No outbound SMTP configured, outbound emails will be queued but not sent');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpConfig.host,
      port: smtpConfig.port,
      secure: smtpConfig.secure,
      auth: {
        user: smtpConfig.username,
        pass: smtpConfig.password,
      },
    });

    console.log(`[SmtpGateway] Transporter initialized: ${smtpConfig.username} -> ${smtpConfig.fromAddress}`);
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
    const { messageStore } = this.deps;
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
    const { eventBus, messageStore } = this.deps;
    
    const item = this.messageQueue.getById(queueItemId);
    if (!item) return;

    // Update message status to sent
    messageStore.updateStatus(item.messageId, 'sent');

    // Emit sent event
    eventBus.emit(EventType.MESSAGE_SENT, {
      messageId: item.messageId,
      fromAddress: this.deps.config.smtpOutbound?.fromAddress || 'unknown',
      toAddress: item.externalTo,
    });

    // Mark queue item as completed
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
    
    console.log(`[SmtpGateway] Starting queue processor (interval: ${config.smtpQueueInterval}ms)`);
    
    this.queueProcessorInterval = setInterval(() => {
      this.processQueue().catch(err => {
        console.error('[SmtpGateway] Queue processing error:', err);
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
      console.log('[SmtpGateway] Queue processor stopped');
    }
  }

  /**
   * Process pending items in the queue
   */
  private async processQueue(): Promise<void> {
    const pending = this.messageQueue.getPending();
    
    if (pending.length === 0) return;

    console.log(`[SmtpGateway] Processing ${pending.length} pending delivery(ies)`);

    for (const item of pending) {
      // Mark as sending
      this.messageQueue.markAsSending(item.id);

      try {
        // Get the original message
        const { messageStore } = this.deps;
        const message = messageStore.getById(item.messageId);
        
        if (!message) {
          throw new Error(`Message not found: ${item.messageId}`);
        }

        // Send via SMTP
        await this.sendEmail({
          to: item.externalTo,
          subject: message.subject || 'No Subject',
          body: message.body,
          from: message.fromAddress,
        });

        // Success
        console.log(`[SmtpGateway] Email sent to ${item.externalTo}`);
        await this.markDeliveryCompleted(item.id);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[SmtpGateway] Failed to send to ${item.externalTo}: ${errorMsg}`);
        await this.markDeliveryFailed(item.id, errorMsg);
      }
    }
  }

  /**
   * Send email via configured SMTP server
   */
  private async sendEmail(input: {
    to: string;
    subject: string;
    body: string;
    from: string;
  }): Promise<void> {
    const smtpConfig = this.deps.config.smtpOutbound;

    if (!this.transporter) {
      throw new Error('SMTP not configured');
    }

    const mailOptions = {
      from: smtpConfig?.fromName 
        ? `"${smtpConfig.fromName}" <${smtpConfig.fromAddress}>`
        : smtpConfig?.fromAddress,
      to: input.to,
      subject: `[Bounty Mailbox] ${input.subject}`,
      text: `From: ${input.from}\n\n${input.body}`,
      html: `<p><strong>From:</strong> ${input.from}</p><p>${input.body.replace(/\n/g, '<br>')}</p>`,
    };

    const result = await this.transporter.sendMail(mailOptions);
    console.log(`[SmtpGateway] SMTP send result: ${result.messageId}`);
  }

  /**
   * Verify SMTP connection
   */
  async verifyConnection(): Promise<boolean> {
    if (!this.transporter) {
      return false;
    }

    try {
      await this.transporter.verify();
      console.log('[SmtpGateway] SMTP connection verified');
      return true;
    } catch (error) {
      console.error('[SmtpGateway] SMTP connection failed:', error);
      return false;
    }
  }

  /**
   * Stop the gateway
   */
  stop(): void {
    this.stopQueueProcessor();
  }
}
