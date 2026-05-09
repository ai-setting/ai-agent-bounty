import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { SmtpGateway } from '../../src/lib/mailbox/smtp-gateway';
import { MessageStore } from '../../src/lib/mailbox/message-store';
import { AddressManager } from '../../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../../src/lib/mailbox/event-bus';
import type { MailboxConfig } from '../../src/lib/mailbox/config';

describe('SmtpGateway', () => {
  let db: Database;
  let messageStore: MessageStore;
  let addressManager: AddressManager;
  let eventBus: EventBus;
  let gateway: SmtpGateway;
  let config: MailboxConfig;

  const testConfig: MailboxConfig = {
    domain: 'local',
    httpPort: 3001,
    websocketEnabled: false,
    heartbeatInterval: 30000,
    maxIdleTime: 120000,
    smtpEnabled: true,
    smtpInboundPort: 2525,
    smtpQueueInterval: 1000,
    databasePath: ':memory:',
  };

  beforeEach(() => {
    db = new Database({ memory: true });
    messageStore = new MessageStore(db);
    addressManager = new AddressManager(db, testConfig.domain);
    eventBus = new EventBus();
    config = { ...testConfig };
    
    // Create test addresses
    addressManager.register('agent-1', 'alice');
    addressManager.register('agent-2', 'bob');
  });

  afterEach(() => {
    gateway?.stop();
  });

  describe('Inbound SMTP', () => {
    it('should queue email for local delivery', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const onMessageReceived = vi.fn();
      eventBus.on(EventType.MESSAGE_RECEIVED, onMessageReceived);

      await gateway.queueInboundEmail({
        from: 'external@other.com',
        to: 'alice@local',
        subject: 'Test Email',
        body: 'Hello from external!',
      });

      // Check message was stored
      const inbox = messageStore.getInbox('alice@local');
      expect(inbox.length).toBe(1);
      expect(inbox[0].subject).toBe('Test Email');
      expect(inbox[0].body).toBe('Hello from external!');

      // Check event was emitted
      expect(onMessageReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          toAddress: 'alice@local',
        })
      );
    });

    it('should reject email to non-existent local address', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      await expect(gateway.queueInboundEmail({
        from: 'external@other.com',
        to: 'nonexistent@local',
        subject: 'Test',
        body: 'Body',
      })).rejects.toThrow('Address not found');
    });

    it('should accept email from any source', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      await gateway.queueInboundEmail({
        from: 'anyone@anywhere.com',
        to: 'bob@local',
        subject: 'External sender',
        body: 'External body',
      });

      const inbox = messageStore.getInbox('bob@local');
      expect(inbox.length).toBe(1);
      expect(inbox[0].fromAddress).toBe('anyone@anywhere.com');
    });
  });

  describe('Outbound SMTP', () => {
    it('should enqueue message for external delivery', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      // Send internal message
      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'external@example.com', // external address
        subject: 'Outgoing',
        body: 'This goes outside',
      });

      // Queue for external delivery
      await gateway.queueOutboundEmail(msg.id);

      // Check queue
      const pending = gateway.getPendingDeliveries();
      expect(pending.length).toBe(1);
      expect(pending[0].externalTo).toBe('external@example.com');
    });

    it('should not queue internal-to-internal messages', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'bob@local', // internal address
        subject: 'Internal',
        body: 'Internal only',
      });

      await gateway.queueOutboundEmail(msg.id);

      const pending = gateway.getPendingDeliveries();
      expect(pending.length).toBe(0);
    });

    it('should mark delivery as completed', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'external@test.com',
        body: 'Test',
      });

      await gateway.queueOutboundEmail(msg.id);
      const pending = gateway.getPendingDeliveries();
      const item = pending[0];

      await gateway.markDeliveryCompleted(item.id);

      const updated = gateway.getPendingDeliveries();
      expect(updated.length).toBe(0);
    });

    it('should schedule retry on failure if attempts remaining', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'external@test.com',
        body: 'Test',
      });

      await gateway.queueOutboundEmail(msg.id);
      const pending = gateway.getPendingDeliveries();
      const item = pending[0];

      // First failure - should schedule retry (pending, not failed)
      await gateway.markDeliveryFailed(item.id, 'SMTP error');

      // Check that retry was scheduled by getting the item directly
      const allItems = gateway.getAllQueueItems();
      const retried = allItems.find(i => i.id === item.id);
      expect(retried).toBeDefined();
      expect(retried?.status).toBe('pending');
      expect(retried?.nextRetryAt).toBeGreaterThan(Date.now());
    });

    it('should mark permanently failed after max retries', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'external@test.com',
        body: 'Test',
      });

      await gateway.queueOutboundEmail(msg.id);
      const pending = gateway.getPendingDeliveries();
      const item = pending[0];

      // Fail 3 times (max retries)
      for (let i = 0; i < 3; i++) {
        await gateway.markDeliveryFailed(item.id, `Error ${i}`);
      }

      // Should now be permanently failed
      const allItems = gateway.getAllQueueItems();
      const failed = allItems.find(i => i.id === item.id);
      expect(failed?.status).toBe('failed');
      expect(failed?.error).toBe('Error 2');
    });
  });

  describe('Queue Processing', () => {
    it('should start and stop queue processor', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      // Queue a message
      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'external@test.com',
        body: 'Test',
      });
      await gateway.queueOutboundEmail(msg.id);

      // Start processing (won't actually send since no SMTP server)
      gateway.startQueueProcessor();

      // Wait for one processing cycle
      await new Promise(resolve => setTimeout(resolve, 1500));

      gateway.stopQueueProcessor();
    });
  });
});
