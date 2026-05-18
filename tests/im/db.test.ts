import { describe, it, expect, beforeEach } from 'bun:test';
import { IMDatabase } from '../../src/im/db';
import type { Message, Agent, Content } from '../../src/im/types';

describe('IMDatabase', () => {
  let db: IMDatabase;

  beforeEach(() => {
    db = new IMDatabase({ memory: true });
  });

  describe('Messages', () => {
    it('should save and retrieve a message', () => {
      const message: Message = {
        id: 'msg-001',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Hello Bob' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      const retrieved = db.getMessage('msg-001');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('msg-001');
      expect(retrieved?.from).toBe('alice@server.com');
      expect(retrieved?.to).toBe('bob@server.com');
      expect(retrieved?.content).toEqual({ type: 'text', body: 'Hello Bob' });
      expect(retrieved?.status).toBe('pending');
    });

    it('should return null for non-existent message', () => {
      const retrieved = db.getMessage('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should update message status to delivered', () => {
      const message: Message = {
        id: 'msg-002',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Test' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      db.updateMessageStatus('msg-002', 'delivered');
      const updated = db.getMessage('msg-002');

      expect(updated?.status).toBe('delivered');
      expect(updated?.deliveredAt).toBeDefined();
    });

    it('should update message status to acked', () => {
      const message: Message = {
        id: 'msg-003',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Test' },
        status: 'delivered',
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      db.updateMessageStatus('msg-003', 'acked');
      const updated = db.getMessage('msg-003');

      expect(updated?.status).toBe('acked');
      expect(updated?.ackedAt).toBeDefined();
    });

    it('should get messages for inbox (newest first)', () => {
      // Use different timestamps to ensure predictable ordering
      const t1 = new Date('2025-01-15T10:00:00.000Z').toISOString();
      const t2 = new Date('2025-01-15T10:00:01.000Z').toISOString();
      const t3 = new Date('2025-01-15T10:00:02.000Z').toISOString();
      
      const messages: Message[] = [
        { id: 'msg-003', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 1' }, status: 'pending', createdAt: t1 },
        { id: 'msg-004', from: 'carol@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 2' }, status: 'delivered', createdAt: t2 },
        { id: 'msg-005', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 3' }, status: 'acked', createdAt: t3 },
      ];

      messages.forEach(m => db.saveMessage(m));
      const inbox = db.getInbox('bob@server.com');

      expect(inbox).toHaveLength(3);
      expect(inbox[0].id).toBe('msg-005'); // Most recent first
      expect(inbox[1].id).toBe('msg-004');
      expect(inbox[2].id).toBe('msg-003');
    });

    it('should get only pending messages for offline sync', () => {
      const now = new Date().toISOString();
      const messages: Message[] = [
        { id: 'msg-006', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 1' }, status: 'pending', createdAt: now },
        { id: 'msg-007', from: 'carol@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 2' }, status: 'delivered', createdAt: now },
        { id: 'msg-008', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 3' }, status: 'acked', createdAt: now },
      ];

      messages.forEach(m => db.saveMessage(m));
      const pending = db.getPendingMessages('bob@server.com');

      // Only pending messages are returned - delivered/acked are already handled
      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('msg-006');
    });

    it('should return empty inbox for address with no messages', () => {
      const inbox = db.getInbox('nonexistent@server.com');
      expect(inbox).toHaveLength(0);
    });

    it('should handle different content types', () => {
      const now = new Date().toISOString();
      const messages: Message[] = [
        { id: 'msg-img', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'image', body: { url: 'https://example.com/img.jpg', width: 100, height: 100 } }, status: 'pending', createdAt: now },
        { id: 'msg-json', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'json', body: { action: 'ping', timestamp: 1234567890 } }, status: 'pending', createdAt: now },
        { id: 'msg-mixed', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'mixed', body: [{ type: 'text', body: 'Hello' }] }, status: 'pending', createdAt: now },
      ];

      messages.forEach(m => db.saveMessage(m));
      const inbox = db.getInbox('bob@server.com');

      expect(inbox).toHaveLength(3);
      const imgMsg = inbox.find(m => m.id === 'msg-img');
      expect(imgMsg?.content.type).toBe('image');
      expect((imgMsg?.content as any).body.width).toBe(100);

      const jsonMsg = inbox.find(m => m.id === 'msg-json');
      expect(jsonMsg?.content.type).toBe('json');
      expect((jsonMsg?.content as any).body.action).toBe('ping');
    });

    it('should overwrite existing message on save', () => {
      const message: Message = {
        id: 'msg-009',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Original' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      db.saveMessage({ ...message, content: { type: 'text', body: 'Updated' } });

      const retrieved = db.getMessage('msg-009');
      expect((retrieved?.content as any).body).toBe('Updated');
    });
  });

  describe('Agents', () => {
    it('should register an agent', () => {
      const agent: Agent = {
        id: 'agent-001',
        host: 'server.com',
        address: 'alice@server.com',
        name: 'Alice',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      const retrieved = db.getAgentByAddress('alice@server.com');

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('agent-001');
      expect(retrieved?.name).toBe('Alice');
      expect(retrieved?.status).toBe('online');
    });

    it('should get agent by id', () => {
      const agent: Agent = {
        id: 'agent-002',
        host: 'server.com',
        address: 'bob@server.com',
        status: 'offline',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      const retrieved = db.getAgentById('agent-002');

      expect(retrieved).toBeDefined();
      expect(retrieved?.address).toBe('bob@server.com');
    });

    it('should return null for non-existent agent by address', () => {
      const retrieved = db.getAgentByAddress('nonexistent@server.com');
      expect(retrieved).toBeNull();
    });

    it('should return null for non-existent agent by id', () => {
      const retrieved = db.getAgentById('nonexistent-id');
      expect(retrieved).toBeNull();
    });

    it('should update agent status', () => {
      const agent: Agent = {
        id: 'agent-003',
        host: 'server.com',
        address: 'carol@server.com',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      db.updateAgentStatus('agent-003', 'offline');
      const updated = db.getAgentById('agent-003');

      expect(updated?.status).toBe('offline');
    });

    it('should update lastSeenAt when changing status', () => {
      const originalTime = new Date('2025-01-01T00:00:00.000Z').toISOString();
      const agent: Agent = {
        id: 'agent-004',
        host: 'server.com',
        address: 'david@server.com',
        status: 'online',
        lastSeenAt: originalTime,
        createdAt: originalTime,
      };

      db.saveAgent(agent);
      db.updateAgentStatus('agent-004', 'offline');
      const updated = db.getAgentById('agent-004');

      expect(updated?.lastSeenAt).not.toBe(originalTime);
      expect(new Date(updated?.lastSeenAt || '').getTime()).toBeGreaterThan(new Date(originalTime).getTime());
    });

    it('should handle agent with optional name', () => {
      const agent: Agent = {
        id: 'agent-005',
        host: 'server.com',
        address: 'eve@server.com',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      const retrieved = db.getAgentByAddress('eve@server.com');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBeUndefined();
    });

    it('should overwrite existing agent on save', () => {
      const now = new Date().toISOString();
      const agent: Agent = {
        id: 'agent-006',
        host: 'server.com',
        address: 'frank@server.com',
        name: 'Frank Original',
        status: 'online',
        lastSeenAt: now,
        createdAt: now,
      };

      db.saveAgent(agent);
      db.saveAgent({ ...agent, name: 'Frank Updated', status: 'offline' });

      const retrieved = db.getAgentByAddress('frank@server.com');
      expect(retrieved?.name).toBe('Frank Updated');
      expect(retrieved?.status).toBe('offline');
    });

    it('should maintain unique address constraint', () => {
      const agent1: Agent = {
        id: 'agent-007',
        host: 'server.com',
        address: 'unique@server.com',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      const agent2: Agent = {
        id: 'agent-007-different',
        host: 'server.com',
        address: 'unique@server.com', // Same address, different id
        status: 'offline',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent1);
      db.saveAgent(agent2); // Should overwrite due to INSERT OR REPLACE

      const retrieved = db.getAgentByAddress('unique@server.com');
      expect(retrieved?.id).toBe('agent-007-different');
    });
  });

  describe('Database Configuration', () => {
    it('should create tables with correct schema', () => {
      // Verify by inserting and retrieving data
      const message: Message = {
        id: 'schema-test-msg',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Schema test' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const agent: Agent = {
        id: 'schema-test-agent',
        host: 'server.com',
        address: 'schema-test@server.com',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      db.saveAgent(agent);

      const retrievedMsg = db.getMessage('schema-test-msg');
      const retrievedAgent = db.getAgentByAddress('schema-test@server.com');

      expect(retrievedMsg).toBeDefined();
      expect(retrievedAgent).toBeDefined();
    });

    it('should support multiple database instances', () => {
      const db1 = new IMDatabase({ memory: true });
      const db2 = new IMDatabase({ memory: true });

      const message1: Message = {
        id: 'db1-msg',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'From DB1' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      const message2: Message = {
        id: 'db2-msg',
        from: 'charlie@server.com',
        to: 'david@server.com',
        content: { type: 'text', body: 'From DB2' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };

      db1.saveMessage(message1);
      db2.saveMessage(message2);

      expect(db1.getMessage('db1-msg')).toBeDefined();
      expect(db1.getMessage('db2-msg')).toBeNull();
      expect(db2.getMessage('db1-msg')).toBeNull();
      expect(db2.getMessage('db2-msg')).toBeDefined();
    });
  });
});
