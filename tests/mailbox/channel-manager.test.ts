import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { ChannelManager } from '../../src/lib/mailbox/channel-manager';

describe('ChannelManager', () => {
  let db: Database;
  let manager: ChannelManager;

  beforeEach(() => {
    db = new Database({ memory: true });
    manager = new ChannelManager(db);
  });

  it('should register a websocket channel', () => {
    const channel = manager.register('agent-1', 'websocket');
    
    expect(channel).toBeDefined();
    expect(channel.agentId).toBe('agent-1');
    expect(channel.type).toBe('websocket');
    expect(channel.status).toBe('connected');
  });

  it('should register an http channel', () => {
    const channel = manager.register('agent-2', 'http');
    
    expect(channel.type).toBe('http');
  });

  it('should update heartbeat', () => {
    const channel = manager.register('agent-3', 'websocket');
    const before = channel.lastHeartbeat;
    
    // Simulate time passing
    manager.updateHeartbeat(channel.id);
    const after = manager.getById(channel.id);
    
    expect(after!.lastHeartbeat).toBeGreaterThanOrEqual(before);
  });

  it('should disconnect channel', () => {
    const channel = manager.register('agent-4', 'websocket');
    
    const disconnected = manager.disconnect(channel.id);
    expect(disconnected).toBe(true);
    
    const found = manager.getById(channel.id);
    expect(found?.status).toBe('disconnected');
  });

  it('should get channels by agent', () => {
    manager.register('agent-5', 'websocket');
    manager.register('agent-5', 'http');
    
    const channels = manager.getByAgentId('agent-5');
    expect(channels.length).toBe(2);
  });

  it('should find connected agent channels', () => {
    const ch1 = manager.register('agent-6', 'websocket');
    manager.register('agent-6', 'http');
    manager.disconnect(ch1.id);
    
    const connected = manager.getConnectedChannels('agent-6');
    expect(connected.length).toBe(1);
    expect(connected[0].type).toBe('http');
  });

  it('should cleanup stale channels', () => {
    const channel = manager.register('agent-7', 'websocket');
    // Manually set lastHeartbeat to old value
    db.prepare('UPDATE mailbox_channels SET last_heartbeat = 0 WHERE id = ?').run(channel.id);
    
    const cleaned = manager.cleanupStale(60000); // 1 minute max idle
    expect(cleaned).toBe(1);
    
    const found = manager.getById(channel.id);
    expect(found?.status).toBe('disconnected');
  });
});
