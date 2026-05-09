import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { SmtpGateway } from '../../src/lib/mailbox/smtp-gateway';
import { MessageStore } from '../../src/lib/mailbox/message-store';
import { AddressManager } from '../../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../../src/lib/mailbox/event-bus';
import type { MailboxConfig, SmtpOutboundConfig } from '../../src/lib/mailbox/config';

describe('SmtpGateway Outbound', () => {
  let db: Database;
  let messageStore: MessageStore;
  let addressManager: AddressManager;
  let eventBus: EventBus;
  let gateway: SmtpGateway;
  let config: MailboxConfig;

  const outboundConfig: SmtpOutboundConfig = {
    host: process.env.SMTP_HOST || 'smtp.example.com',
    port: 587,
    secure: false,
    username: process.env.SMTP_USER || 'test@example.com',
    password: process.env.SMTP_PASS || 'password',
    fromAddress: process.env.SMTP_FROM || 'bounty@local',
  };

  beforeEach(() => {
    db = new Database({ memory: true });
    messageStore = new MessageStore(db);
    addressManager = new AddressManager(db, 'local');
    eventBus = new EventBus();
    
    addressManager.register('agent-1', 'alice');
    addressManager.register('agent-2', 'bob');
    
    config = {
      domain: 'local',
      httpPort: 3001,
      websocketEnabled: false,
      heartbeatInterval: 30000,
      maxIdleTime: 120000,
      smtpEnabled: true,
      smtpInboundPort: 2525,
      smtpQueueInterval: 1000,
      databasePath: ':memory:',
      smtpOutbound: outboundConfig,
    };
  });

  afterEach(() => {
    gateway?.stop();
  });

  describe('Configuration', () => {
    it('should accept smtpOutbound configuration', () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      expect(gateway).toBeDefined();
    });

    it('should work without smtpOutbound (disabled outbound)', () => {
      const configNoOutbound = { ...config, smtpOutbound: undefined };
      
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config: configNoOutbound,
      });

      expect(gateway).toBeDefined();
    });

    it('should have outbound config with fromAddress', () => {
      expect(config.smtpOutbound?.fromAddress).toBeDefined();
      expect(config.smtpOutbound?.fromAddress).toContain('@');
    });
  });

  describe('Outbound Email', () => {
    it('should queue external email for delivery with config', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'gddzhaokun@163.com', // external address
        subject: 'Test External Email',
        body: 'This should be sent to external email',
      });

      await gateway.queueOutboundEmail(msg.id);

      const pending = gateway.getPendingDeliveries();
      expect(pending.length).toBe(1);
      expect(pending[0].externalTo).toBe('gddzhaokun@163.com');
    });

    it('should support configurable external email addresses', async () => {
      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const externalAddresses = [
        'user1@gmail.com',
        'user2@hotmail.com', 
        'gddzhaokun@163.com',
      ];

      for (const toAddr of externalAddresses) {
        const msg = messageStore.send({
          fromAddress: 'alice@local',
          toAddress: toAddr,
          body: `Test to ${toAddr}`,
        });
        await gateway.queueOutboundEmail(msg.id);
      }

      const pending = gateway.getPendingDeliveries();
      expect(pending.length).toBe(3);
    });
  });

  describe('Send Status', () => {
    it('should emit message.sent event on successful send', async () => {
      let sentEvent: any;
      eventBus.on(EventType.MESSAGE_SENT, (data) => {
        sentEvent = data;
      });

      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'gddzhaokun@163.com',
        body: 'Test',
      });

      await gateway.queueOutboundEmail(msg.id);
      const pending = gateway.getPendingDeliveries();
      
      // Simulate successful send
      await gateway.markDeliveryCompleted(pending[0].id);

      expect(sentEvent).toBeDefined();
      expect(sentEvent.messageId).toBe(msg.id);
    });

    it('should emit message.failed event on permanent failure', async () => {
      let failedEvent: any;
      eventBus.on(EventType.MESSAGE_FAILED, (data) => {
        failedEvent = data;
      });

      gateway = new SmtpGateway({
        db,
        messageStore,
        addressManager,
        eventBus,
        config,
      });

      const msg = messageStore.send({
        fromAddress: 'alice@local',
        toAddress: 'gddzhaokun@163.com',
        body: 'Test',
      });

      await gateway.queueOutboundEmail(msg.id);
      const pending = gateway.getPendingDeliveries();

      // Fail 3 times to trigger permanent failure
      for (let i = 0; i < 3; i++) {
        await gateway.markDeliveryFailed(pending[0].id, `SMTP error ${i}`);
      }

      expect(failedEvent).toBeDefined();
      expect(failedEvent.messageId).toBe(msg.id);
      expect(failedEvent.error).toContain('SMTP error');
    });
  });
});
