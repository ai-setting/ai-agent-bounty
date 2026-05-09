import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { MailboxService } from '../../src/lib/mailbox/mailbox-service';
import { EventBus } from '../../src/lib/mailbox/event-bus';

describe('MailboxService', () => {
  let db: Database;
  let eventBus: EventBus;
  let service: MailboxService;

  beforeEach(() => {
    db = new Database({ memory: true });
    eventBus = new EventBus();
    service = new MailboxService(db, eventBus);
  });

  describe('Address Management', () => {
    it('should register agent address', () => {
      const addr = service.registerAddress('agent-1', 'Alice');
      
      expect(addr.address).toBe('alice@local');
    });

    it('should get address by agent', () => {
      service.registerAddress('agent-2', 'Bob');
      const addr = service.getAddressByAgent('agent-2');
      
      expect(addr?.address).toBe('bob@local');
    });
  });

  describe('Message Operations', () => {
    beforeEach(() => {
      service.registerAddress('alice', 'Alice');
      service.registerAddress('bob', 'Bob');
    });

    it('should send message', (done) => {
      eventBus.on('message.sent', (data) => {
        expect(data.fromAddress).toBe('alice@local');
        expect(data.toAddress).toBe('bob@local');
        done();
      });

      service.send({
        fromAddress: 'alice@local',
        toAddress: 'bob@local',
        subject: 'Test',
        body: 'Hello Bob',
      });
    });

    it('should receive message in inbox', () => {
      service.send({
        fromAddress: 'alice@local',
        toAddress: 'bob@local',
        body: 'Hello',
      });

      const inbox = service.getInbox('bob@local');
      expect(inbox.length).toBe(1);
      expect(inbox[0].body).toBe('Hello');
    });

    it('should mark as read', (done) => {
      const msg = service.send({
        fromAddress: 'alice@local',
        toAddress: 'bob@local',
        body: 'Read me',
      });

      eventBus.on('message.read', (data) => {
        expect(data.messageId).toBe(msg.id);
        done();
      });

      service.markAsRead(msg.id);
    });

    it('should count unread', () => {
      service.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 1' });
      service.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 2' });

      const count = service.getUnreadCount('bob@local');
      expect(count).toBe(2);
    });
  });

  describe('Channel Management', () => {
    it('should connect agent', () => {
      service.registerAddress('agent-1', 'Alice');
      const channel = service.connect('agent-1', 'websocket');

      expect(channel.status).toBe('connected');
    });

    it('should disconnect agent', () => {
      service.registerAddress('agent-2', 'Bob');
      service.connect('agent-2', 'websocket');
      
      service.disconnect('agent-2');
      
      const channels = service.getChannels('agent-2');
      expect(channels.every(c => c.status === 'disconnected')).toBe(true);
    });
  });
});
