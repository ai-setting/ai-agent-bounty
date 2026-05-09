import { describe, it, expect, beforeEach } from 'bun:test';
import { EventBus, EventType } from '../../src/lib/mailbox/event-bus';

describe('EventBus', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = new EventBus();
  });

  it('should emit and receive events', (done) => {
    eventBus.on('message.received', (data) => {
      expect(data.messageId).toBe('msg-1');
      done();
    });
    
    eventBus.emit('message.received', { messageId: 'msg-1' });
  });

  it('should support multiple listeners', () => {
    let count = 0;
    eventBus.on('test', () => count++);
    eventBus.on('test', () => count++);
    
    eventBus.emit('test', {});
    expect(count).toBe(2);
  });

  it('should remove listeners', () => {
    let count = 0;
    const handler = () => count++;
    eventBus.on('test', handler);
    eventBus.off('test', handler);
    
    eventBus.emit('test', {});
    expect(count).toBe(0);
  });

  it('should support once() for single-use listeners', (done) => {
    eventBus.once('message.sent', (data) => {
      expect(data.messageId).toBe('msg-2');
      done();
    });
    
    eventBus.emit('message.sent', { messageId: 'msg-2' });
    eventBus.emit('message.sent', { messageId: 'msg-3' }); // Should not trigger
  });

  it('should list supported event types', () => {
    const types = EventBus.getEventTypes();
    expect(types).toContain('message.received');
    expect(types).toContain('message.sent');
    expect(types).toContain('channel.connected');
  });
});
