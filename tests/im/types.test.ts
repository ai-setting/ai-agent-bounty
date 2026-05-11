import { describe, it, expect } from 'bun:test';
import type {
  Message,
  Agent,
  Content,
  TextContent,
  ImageContent,
  MixedContent,
  JsonContent,
  FileContent,
  ContentType,
  MessageStatus,
  AgentStatus,
  SendMessageInput,
  AckInput,
} from '../../src/im/types';

describe('Agent IM Types', () => {
  describe('Content Types', () => {
    it('should accept text content', () => {
      const content: TextContent = { type: 'text', body: 'Hello!' };
      expect(content.type).toBe('text');
      expect(content.body).toBe('Hello!');
    });

    it('should accept image content', () => {
      const content: ImageContent = {
        type: 'image',
        body: {
          url: 'https://example.com/photo.jpg',
          width: 1920,
          height: 1080,
          format: 'jpeg',
        },
      };
      expect(content.type).toBe('image');
      expect(content.body.url).toBe('https://example.com/photo.jpg');
      expect(content.body.width).toBe(1920);
      expect(content.body.height).toBe(1080);
      expect(content.body.format).toBe('jpeg');
    });

    it('should accept image content with optional fields', () => {
      const content: ImageContent = {
        type: 'image',
        body: {
          url: 'https://example.com/photo.jpg',
          thumbnailUrl: 'https://example.com/photo_thumb.jpg',
          size: 1024000,
          alt: 'A beautiful photo',
        },
      };
      expect(content.body.thumbnailUrl).toBe('https://example.com/photo_thumb.jpg');
      expect(content.body.size).toBe(1024000);
      expect(content.body.alt).toBe('A beautiful photo');
    });

    it('should accept mixed content', () => {
      const content: MixedContent = {
        type: 'mixed',
        body: [
          { type: 'text', body: 'Hello!' },
          { type: 'image', body: { url: 'https://example.com/photo.jpg' } },
        ],
      };
      expect(content.type).toBe('mixed');
      expect(content.body).toHaveLength(2);
      expect(content.body[0].type).toBe('text');
      expect(content.body[1].type).toBe('image');
    });

    it('should accept json content', () => {
      const content: JsonContent = {
        type: 'json',
        body: { key: 'value', number: 42, nested: { foo: 'bar' } },
      };
      expect(content.type).toBe('json');
      expect(content.body.key).toBe('value');
      expect(content.body.number).toBe(42);
      expect(content.body.nested.foo).toBe('bar');
    });

    it('should accept file content', () => {
      const content: FileContent = {
        type: 'file',
        body: {
          name: 'document.pdf',
          url: 'https://example.com/document.pdf',
          size: 1024000,
          format: 'pdf',
        },
      };
      expect(content.type).toBe('file');
      expect(content.body.name).toBe('document.pdf');
      expect(content.body.url).toBe('https://example.com/document.pdf');
      expect(content.body.size).toBe(1024000);
      expect(content.body.format).toBe('pdf');
    });

    it('should allow Content type to be any content type', () => {
      const texts: Content[] = [
        { type: 'text', body: 'Hello' },
        { type: 'image', body: { url: 'https://example.com/photo.jpg' } },
        { type: 'mixed', body: [{ type: 'text', body: 'Mixed' }] },
        { type: 'json', body: { data: 'value' } },
        { type: 'file', body: { name: 'file.txt', url: 'https://example.com/file.txt' } },
      ];
      expect(texts).toHaveLength(5);
    });
  });

  describe('ContentType', () => {
    it('should accept valid content types', () => {
      const types: ContentType[] = ['text', 'image', 'mixed', 'json', 'file'];
      expect(types).toHaveLength(5);
    });
  });

  describe('Message', () => {
    it('should create a valid message', () => {
      const message: Message = {
        id: 'msg-001',
        from: 'alice@example.com',
        to: 'bob@example.com',
        content: { type: 'text', body: 'Hello Bob!' },
        status: 'pending',
        createdAt: '2025-01-15T10:00:00.000Z',
      };
      expect(message.id).toBe('msg-001');
      expect(message.from).toBe('alice@example.com');
      expect(message.to).toBe('bob@example.com');
      expect(message.content).toEqual({ type: 'text', body: 'Hello Bob!' });
      expect(message.status).toBe('pending');
      expect(message.createdAt).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should validate address format', () => {
      const message: Message = {
        id: 'test-id',
        from: 'alice@server.example.com',
        to: 'bob@server.example.com',
        content: { type: 'text', body: 'Hi' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      expect(message.from).toMatch(/^[\w-]+@[\w.-]+$/);
      expect(message.to).toMatch(/^[\w-]+@[\w.-]+$/);
    });

    it('should support all message statuses', () => {
      const statuses: MessageStatus[] = ['pending', 'delivered', 'acked'];
      statuses.forEach((status, index) => {
        const message: Message = {
          id: `msg-${index}`,
          from: 'alice@example.com',
          to: 'bob@example.com',
          content: { type: 'text', body: 'Test' },
          status,
          createdAt: new Date().toISOString(),
        };
        expect(message.status).toBe(status);
      });
    });

    it('should support optional timestamps', () => {
      const message: Message = {
        id: 'msg-001',
        from: 'alice@example.com',
        to: 'bob@example.com',
        content: { type: 'text', body: 'Hello' },
        status: 'acked',
        createdAt: '2025-01-15T10:00:00.000Z',
        deliveredAt: '2025-01-15T10:00:01.000Z',
        ackedAt: '2025-01-15T10:00:02.000Z',
      };
      expect(message.deliveredAt).toBe('2025-01-15T10:00:01.000Z');
      expect(message.ackedAt).toBe('2025-01-15T10:00:02.000Z');
    });

    it('should support different content types', () => {
      const messages: Message[] = [
        {
          id: 'msg-1',
          from: 'alice@example.com',
          to: 'bob@example.com',
          content: { type: 'text', body: 'Text message' },
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg-2',
          from: 'alice@example.com',
          to: 'bob@example.com',
          content: { type: 'image', body: { url: 'https://example.com/img.jpg' } },
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'msg-3',
          from: 'alice@example.com',
          to: 'bob@example.com',
          content: { type: 'json', body: { action: 'ping' } },
          status: 'pending',
          createdAt: new Date().toISOString(),
        },
      ];
      expect(messages).toHaveLength(3);
    });
  });

  describe('Agent', () => {
    it('should create a valid agent', () => {
      const agent: Agent = {
        id: 'alice',
        host: 'server.example.com',
        address: 'alice@server.example.com',
        name: 'Alice',
        status: 'online',
        lastSeenAt: '2025-01-15T10:00:00.000Z',
        createdAt: '2025-01-15T09:00:00.000Z',
      };
      expect(agent.id).toBe('alice');
      expect(agent.host).toBe('server.example.com');
      expect(agent.address).toBe('alice@server.example.com');
      expect(agent.name).toBe('Alice');
      expect(agent.status).toBe('online');
    });

    it('should support all agent statuses', () => {
      const statuses: AgentStatus[] = ['online', 'offline'];
      statuses.forEach((status) => {
        const agent: Agent = {
          id: 'test-agent',
          host: 'server.com',
          address: 'test-agent@server.com',
          status,
          lastSeenAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        expect(agent.status).toBe(status);
      });
    });

    it('should support optional name', () => {
      const agent: Agent = {
        id: 'alice',
        host: 'server.example.com',
        address: 'alice@server.example.com',
        status: 'offline',
        lastSeenAt: '2025-01-15T10:00:00.000Z',
        createdAt: '2025-01-15T09:00:00.000Z',
      };
      expect(agent.name).toBeUndefined();
    });

    it('should have correct address format', () => {
      const agent: Agent = {
        id: 'user-123',
        host: 'agent-server.ai',
        address: 'user-123@agent-server.ai',
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
      expect(agent.address).toMatch(/^[\w-]+@[\w.-]+$/);
      expect(agent.address).toContain('@');
    });
  });

  describe('API Types', () => {
    it('should support SendMessageInput', () => {
      const input: SendMessageInput = {
        to: 'bob@example.com',
        content: { type: 'text', body: 'Hello!' },
      };
      expect(input.to).toBe('bob@example.com');
      expect(input.content).toEqual({ type: 'text', body: 'Hello!' });
    });

    it('should support AckInput', () => {
      const input: AckInput = {
        messageIds: ['msg-001', 'msg-002', 'msg-003'],
      };
      expect(input.messageIds).toHaveLength(3);
      expect(input.messageIds[0]).toBe('msg-001');
    });
  });
});
