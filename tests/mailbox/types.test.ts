import { describe, it, expect } from 'bun:test';
import type { MailAddress, Message, SendMessageInput } from '../../src/lib/mailbox/types';

describe('Mailbox Types', () => {
  describe('MailAddress', () => {
    it('should have required fields', () => {
      const addr: MailAddress = {
        id: 'test-id',
        agentId: 'agent-1',
        address: 'alice@local',
        type: 'internal',
        createdAt: Date.now(),
      };
      
      expect(addr.address).toContain('@');
      expect(addr.type).toBe('internal');
    });
  });

  describe('Message', () => {
    it('should have valid status values', () => {
      const statuses: Message['status'][] = [
        'pending', 'sent', 'delivered', 'read', 'failed'
      ];
      
      statuses.forEach(status => {
        const msg: Message = {
          id: 'msg-1',
          fromAddress: 'alice@local',
          toAddress: 'bob@local',
          body: 'Hello',
          status,
          createdAt: Date.now(),
        };
        expect(msg.status).toBe(status);
      });
    });
  });
});
