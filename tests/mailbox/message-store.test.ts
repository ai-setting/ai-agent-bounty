import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { MessageStore } from '../../src/lib/mailbox/message-store';
import type { SendMessageInput } from '../../src/lib/mailbox/types';

describe('MessageStore', () => {
  let db: Database;
  let store: MessageStore;

  beforeEach(() => {
    db = new Database({ memory: true });
    store = new MessageStore(db);
  });

  it('should send a message', () => {
    const input: SendMessageInput = {
      fromAddress: 'alice@local',
      toAddress: 'bob@local',
      subject: 'Hello',
      body: 'Test message',
    };
    
    const msg = store.send(input);
    
    expect(msg).toBeDefined();
    expect(msg.fromAddress).toBe('alice@local');
    expect(msg.toAddress).toBe('bob@local');
    expect(msg.status).toBe('sent');
  });

  it('should get message by ID', () => {
    const sent = store.send({
      fromAddress: 'alice@local',
      toAddress: 'bob@local',
      body: 'Hello',
    });
    
    const found = store.getById(sent.id);
    expect(found?.body).toBe('Hello');
  });

  it('should get inbox messages', () => {
    store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 1' });
    store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 2' });
    
    const inbox = store.getInbox('bob@local');
    expect(inbox.length).toBe(2);
  });

  it('should filter inbox by unread', () => {
    store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 1' });
    const msg2 = store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 2' });
    store.markAsRead(msg2.id);
    
    const unread = store.getInbox('bob@local', { unreadOnly: true });
    expect(unread.length).toBe(1);
    expect(unread[0].body).toBe('Msg 1');
  });

  it('should mark message as read', () => {
    const msg = store.send({
      fromAddress: 'alice@local',
      toAddress: 'bob@local',
      body: 'Read me',
    });
    
    const marked = store.markAsRead(msg.id);
    expect(marked).toBe(true);
    
    const updated = store.getById(msg.id);
    expect(updated?.status).toBe('read');
    expect(updated?.readAt).toBeDefined();
  });

  it('should count unread messages', () => {
    store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 1' });
    const msg2 = store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 2' });
    store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: 'Msg 3' });
    store.markAsRead(msg2.id);
    
    const count = store.getUnreadCount('bob@local');
    expect(count).toBe(2);
  });

  it('should delete message', () => {
    const msg = store.send({
      fromAddress: 'alice@local',
      toAddress: 'bob@local',
      body: 'Delete me',
    });
    
    const deleted = store.delete(msg.id);
    expect(deleted).toBe(true);
    expect(store.getById(msg.id)).toBeNull();
  });

  it('should paginate inbox', () => {
    for (let i = 0; i < 15; i++) {
      store.send({ fromAddress: 'alice@local', toAddress: 'bob@local', body: `Msg ${i}` });
    }
    
    const page1 = store.getInbox('bob@local', { limit: 10 });
    const page2 = store.getInbox('bob@local', { limit: 10, offset: 10 });
    
    expect(page1.length).toBe(10);
    expect(page2.length).toBe(5);
  });
});
