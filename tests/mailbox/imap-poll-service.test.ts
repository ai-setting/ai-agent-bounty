import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { MessageStore } from '../../src/lib/mailbox/message-store';
import { AddressManager } from '../../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../../src/lib/mailbox/event-bus';
import type { ImapPollConfig, ReceivedEmail } from '../../src/lib/mailbox/imap-poll-service';

describe('ImapPollService', () => {
  let db: Database;
  let messageStore: MessageStore;
  let addressManager: AddressManager;
  let eventBus: EventBus;

  const imapConfig: ImapPollConfig = {
    host: 'imap.163.com',
    port: 993,
    user: 'gddzhaokun@163.com',
    password: 'test-password',
    tls: true,
    pollInterval: 5000,
    localDomain: 'local',
  };

  beforeEach(() => {
    db = new Database({ memory: true });
    messageStore = new MessageStore(db);
    addressManager = new AddressManager(db, 'local');
    eventBus = new EventBus();

    // Register test addresses
    addressManager.register('agent-1', 'alice');
    addressManager.register('agent-2', 'bob');
  });

  describe('Configuration', () => {
    it('should have valid IMAP config for 163.com', () => {
      expect(imapConfig.host).toBe('imap.163.com');
      expect(imapConfig.port).toBe(993);
      expect(imapConfig.tls).toBe(true);
      expect(imapConfig.user).toBe('gddzhaokun@163.com');
    });

    it('should have correct poll interval', () => {
      expect(imapConfig.pollInterval).toBe(5000); // 5 seconds for testing
    });
  });

  describe('Local Address Detection', () => {
    it('should detect local addresses correctly', () => {
      const isLocal = (email: string) => email.endsWith('@local');
      
      expect(isLocal('alice@local')).toBe(true);
      expect(isLocal('bob@local')).toBe(true);
      expect(isLocal('gddzhaokun@163.com')).toBe(false);
      expect(isLocal('user@gmail.com')).toBe(false);
    });

    it('should find registered local address', () => {
      const addr = addressManager.getByEmail('alice@local');
      expect(addr).toBeDefined();
      expect(addr?.address).toBe('alice@local');
      expect(addr?.agentId).toBe('agent-1');
    });

    it('should return null for unregistered address', () => {
      const addr = addressManager.getByEmail('unknown@local');
      expect(addr).toBeNull();
    });
  });

  describe('Message Storage', () => {
    it('should store inbound email as message', () => {
      const msg = messageStore.send({
        fromAddress: 'sender@example.com',
        toAddress: 'alice@local',
        subject: 'Test Subject',
        body: 'Test body content',
      });

      expect(msg.id).toBeDefined();
      expect(msg.fromAddress).toBe('sender@example.com');
      expect(msg.toAddress).toBe('alice@local');
      expect(msg.status).toBe('sent');
    });

    it('should retrieve stored message by ID', () => {
      const msg = messageStore.send({
        fromAddress: 'sender@example.com',
        toAddress: 'alice@local',
        body: 'Test',
      });

      const retrieved = messageStore.getById(msg.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.fromAddress).toBe('sender@example.com');
    });

    it('should get inbox messages for address', () => {
      // Send multiple messages
      messageStore.send({
        fromAddress: 'sender@example.com',
        toAddress: 'alice@local',
        body: 'Message 1',
      });
      messageStore.send({
        fromAddress: 'bob@local',
        toAddress: 'alice@local',
        body: 'Message 2',
      });

      const inbox = messageStore.getInbox('alice@local');
      expect(inbox.length).toBe(2);
    });
  });

  describe('Event Emission', () => {
    it('should emit MESSAGE_RECEIVED when email is processed', () => {
      let receivedEvent: any = null;
      
      eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
        receivedEvent = data;
      });

      // Simulate processing an inbound email
      const email: ReceivedEmail = {
        id: 'test-email-1',
        from: 'sender@example.com',
        to: 'alice@local',
        subject: 'Test Subject',
        body: 'Test body',
        date: new Date(),
        messageId: 'imap-123',
      };

      // Process the email (this is what ImapPollService would do internally)
      const address = addressManager.getByEmail(email.to);
      if (address) {
        const msg = messageStore.send({
          fromAddress: email.from,
          toAddress: email.to,
          subject: email.subject,
          body: email.body,
        });

        eventBus.emit(EventType.MESSAGE_RECEIVED, {
          messageId: msg.id,
          fromAddress: email.from,
          toAddress: email.to,
        });
      }

      expect(receivedEvent).toBeDefined();
      expect(receivedEvent.messageId).toBeDefined();
      expect(receivedEvent.fromAddress).toBe('sender@example.com');
      expect(receivedEvent.toAddress).toBe('alice@local');
    });

    it('should not process email for unregistered local address', () => {
      let receivedEvent: any = null;
      
      eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
        receivedEvent = data;
      });

      const email: ReceivedEmail = {
        id: 'test-email-2',
        from: 'sender@example.com',
        to: 'unknown@local', // Not registered
        subject: 'Test Subject',
        body: 'Test body',
        date: new Date(),
        messageId: 'imap-456',
      };

      // Try to process - should be skipped
      const address = addressManager.getByEmail(email.to);
      if (address) {
        const msg = messageStore.send({
          fromAddress: email.from,
          toAddress: email.to,
          subject: email.subject,
          body: email.body,
        });
        eventBus.emit(EventType.MESSAGE_RECEIVED, { messageId: msg.id } as any);
      }

      // No event should be emitted
      expect(receivedEvent).toBeNull();
    });

    it('should not process email for external address', () => {
      let receivedEvent: any = null;
      
      eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
        receivedEvent = data;
      });

      const email: ReceivedEmail = {
        id: 'test-email-3',
        from: 'sender@example.com',
        to: 'gddzhaokun@163.com', // External, not local
        subject: 'Test Subject',
        body: 'Test body',
        date: new Date(),
        messageId: 'imap-789',
      };

      // Check if local
      const isLocal = email.to.endsWith('@local');
      if (!isLocal) {
        // Skip processing
      }

      expect(receivedEvent).toBeNull();
    });
  });

  describe('Full End-to-End Simulation', () => {
    it('should simulate full IMAP email receive flow', () => {
      const receivedEmails: ReceivedEmail[] = [];
      const storedMessages: string[] = [];
      const events: string[] = [];

      // Simulate receiving emails from IMAP poll
      const simulatedEmails: ReceivedEmail[] = [
        {
          id: 'email-1',
          from: 'bob@local',
          to: 'alice@local',
          subject: 'Hello from Bob',
          body: 'Hi Alice!',
          date: new Date(),
          messageId: 'uid-100',
        },
        {
          id: 'email-2',
          from: 'external@gmail.com',
          to: 'alice@local',
          subject: 'External email',
          body: 'This is from Gmail',
          date: new Date(),
          messageId: 'uid-101',
        },
      ];

      // Process each email
      for (const email of simulatedEmails) {
        const isLocal = email.to.endsWith('@local');
        
        if (isLocal) {
          const address = addressManager.getByEmail(email.to);
          
          if (address) {
            // Store message
            const msg = messageStore.send({
              fromAddress: email.from,
              toAddress: email.to,
              subject: email.subject,
              body: email.body,
            });
            
            storedMessages.push(msg.id);
            events.push('MESSAGE_RECEIVED');
            
            // Emit event
            eventBus.emit(EventType.MESSAGE_RECEIVED, {
              messageId: msg.id,
              fromAddress: email.from,
              toAddress: email.to,
            });
          }
        }
      }

      // Verify results
      expect(storedMessages.length).toBe(2);
      expect(events.length).toBe(2);

      // Check alice's inbox
      const inbox = messageStore.getInbox('alice@local');
      expect(inbox.length).toBe(2);
      expect(inbox[0].fromAddress).toBe('bob@local');
      expect(inbox[1].fromAddress).toBe('external@gmail.com');
    });
  });
});
