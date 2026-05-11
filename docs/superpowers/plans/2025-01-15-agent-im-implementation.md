# Agent IM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a simple IM-like communication system for AI agents, with WebSocket + HTTP hybrid architecture.

**Architecture:** Center message server with star topology, decentralized address discovery (agent-id@host format), At-Least-Once delivery guarantee.

**Tech Stack:** TypeScript, Bun, SQLite (bun:sqlite), WebSocket (ws)

---

## File Structure

```
src/
├── im/                          # New Agent IM module
│   ├── types.ts                 # Shared types (Message, Agent, Content)
│   ├── db/
│   │   └── index.ts            # SQLite operations for im
│   ├── server/
│   │   ├── index.ts            # Server entry point
│   │   ├── http.ts             # HTTP API routes
│   │   └── ws.ts               # WebSocket handler
│   ├── client/
│   │   ├── index.ts           # Client SDK entry
│   │   ├── mailbox.ts         # Mailbox class (events + send/receive)
│   │   └── ws-client.ts       # WebSocket client
│   └── cli/
│       └── index.ts           # CLI commands
│
tests/
├── im/                         # New test directory
│   ├── types.test.ts
│   ├── db.test.ts
│   ├── server.test.ts
│   └── client.test.ts
```

---

## Phase 1: Core Types and Database

### Task 1: Define Types

**Files:**
- Create: `src/im/types.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/types.test.ts
import { describe, it, expect } from 'bun:test';
import type { Message, Agent, Content, TextContent, ImageContent } from '../../src/im/types';

describe('Agent IM Types', () => {
  describe('Content', () => {
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
    });
  });

  describe('Message', () => {
    it('should validate address format', () => {
      const message: Message = {
        id: 'test-id',
        from: 'alice@example.com',
        to: 'bob@example.com',
        content: { type: 'text', body: 'Hi' },
        status: 'pending',
        createdAt: new Date().toISOString(),
      };
      expect(message.from).toMatch(/^[\w-]+@[\w.-]+$/);
      expect(message.to).toMatch(/^[\w-]+@[\w.-]+$/);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/types.test.ts`
Expected: FAIL with "Cannot find module '../../src/im/types'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/types.ts

export type ContentType = 'text' | 'image' | 'mixed' | 'json' | 'file';

export interface TextContent {
  type: 'text';
  body: string;
}

export interface ImageContent {
  type: 'image';
  body: {
    url: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    size?: number;
    format?: string;
    alt?: string;
  };
}

export interface MixedContent {
  type: 'mixed';
  body: Content[];
}

export interface JsonContent {
  type: 'json';
  body: Record<string, unknown>;
}

export interface FileContent {
  type: 'file';
  body: {
    name: string;
    url: string;
    size?: number;
    format?: string;
  };
}

export type Content = TextContent | ImageContent | MixedContent | JsonContent | FileContent;

export type MessageStatus = 'pending' | 'delivered' | 'acked';

export interface Message {
  id: string;
  from: string;
  to: string;
  content: Content;
  status: MessageStatus;
  createdAt: string;
  deliveredAt?: string;
  ackedAt?: string;
}

export type AgentStatus = 'online' | 'offline';

export interface Agent {
  id: string;
  host: string;
  address: string;
  name?: string;
  status: AgentStatus;
  lastSeenAt: string;
  createdAt: string;
}

export interface SendMessageInput {
  to: string;
  content: Content;
}

export interface AckInput {
  messageIds: string[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/types.ts tests/im/types.test.ts
git commit -m "feat(im): add core types for Agent IM

- Message, Agent, Content types
- Support text, image, mixed, json, file content types
- Address format: agent-id@host"
```

---

### Task 2: Database Layer

**Files:**
- Create: `src/im/db/index.ts`
- Modify: `src/index.ts` (add exports)

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/db.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { IMDatabase } from '../../src/im/db';

describe('IMDatabase', () => {
  let db: IMDatabase;

  beforeEach(() => {
    db = new IMDatabase({ memory: true });
  });

  describe('Messages', () => {
    it('should save and retrieve a message', () => {
      const message = {
        id: 'msg-001',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Hello Bob' },
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      const retrieved = db.getMessage('msg-001');

      expect(retrieved).toBeDefined();
      expect(retrieved?.from).toBe('alice@server.com');
      expect(retrieved?.to).toBe('bob@server.com');
      expect(retrieved?.content).toEqual({ type: 'text', body: 'Hello Bob' });
    });

    it('should update message status', () => {
      const message = {
        id: 'msg-002',
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Test' },
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
      };

      db.saveMessage(message);
      db.updateMessageStatus('msg-002', 'delivered');
      const updated = db.getMessage('msg-002');

      expect(updated?.status).toBe('delivered');
      expect(updated?.deliveredAt).toBeDefined();
    });

    it('should get messages for inbox', () => {
      const messages = [
        { id: 'msg-003', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 1' }, status: 'pending' as const, createdAt: new Date().toISOString() },
        { id: 'msg-004', from: 'carol@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 2' }, status: 'delivered' as const, createdAt: new Date().toISOString() },
        { id: 'msg-005', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 3' }, status: 'acked' as const, createdAt: new Date().toISOString() },
      ];

      messages.forEach(m => db.saveMessage(m));
      const inbox = db.getInbox('bob@server.com');

      expect(inbox).toHaveLength(3);
      expect(inbox[0].id).toBe('msg-005'); // Most recent first
    });

    it('should get only undelivered messages for offline sync', () => {
      const messages = [
        { id: 'msg-006', from: 'alice@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 1' }, status: 'pending' as const, createdAt: new Date().toISOString() },
        { id: 'msg-007', from: 'carol@server.com', to: 'bob@server.com', content: { type: 'text', body: 'Msg 2' }, status: 'delivered' as const, createdAt: new Date().toISOString() },
      ];

      messages.forEach(m => db.saveMessage(m));
      const pending = db.getPendingMessages('bob@server.com');

      expect(pending).toHaveLength(1);
      expect(pending[0].id).toBe('msg-006');
    });
  });

  describe('Agents', () => {
    it('should register an agent', () => {
      const agent = {
        id: 'agent-001',
        host: 'server.com',
        address: 'alice@server.com',
        name: 'Alice',
        status: 'online' as const,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      const retrieved = db.getAgentByAddress('alice@server.com');

      expect(retrieved).toBeDefined();
      expect(retrieved?.name).toBe('Alice');
    });

    it('should update agent status', () => {
      const agent = {
        id: 'agent-002',
        host: 'server.com',
        address: 'bob@server.com',
        status: 'online' as const,
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };

      db.saveAgent(agent);
      db.updateAgentStatus('agent-002', 'offline');
      const updated = db.getAgentById('agent-002');

      expect(updated?.status).toBe('offline');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/db.test.ts`
Expected: FAIL with "Cannot find module '../../src/im/db'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/db/index.ts
import { Database as BunDatabase } from 'bun:sqlite';
import type { Message, Agent, MessageStatus, AgentStatus } from '../types';

export interface IMDatabaseConfig {
  path?: string;
  memory?: boolean;
}

interface MessageRow {
  id: string;
  from_address: string;
  to_address: string;
  content: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
}

interface AgentRow {
  id: string;
  host: string;
  address: string;
  name: string | null;
  status: string;
  last_seen_at: string;
  created_at: string;
}

export class IMDatabase {
  private db: BunDatabase;

  constructor(config: IMDatabaseConfig = {}) {
    const path = config.memory ? ':memory:' : (config.path || './data/im.db');
    this.db = new BunDatabase(path);
    this.initialize();
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS im_messages (
        id TEXT PRIMARY KEY,
        from_address TEXT NOT NULL,
        to_address TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acked_at TEXT
      )
    `);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS im_agents (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        address TEXT UNIQUE NOT NULL,
        name TEXT,
        status TEXT DEFAULT 'offline',
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_messages_to ON im_messages(to_address)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_messages_status ON im_messages(status)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_im_agents_address ON im_agents(address)`);
  }

  // Message operations
  saveMessage(message: Message): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO im_messages 
      (id, from_address, to_address, content, status, created_at, delivered_at, acked_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      message.id,
      message.from,
      message.to,
      JSON.stringify(message.content),
      message.status,
      message.createdAt,
      message.deliveredAt || null,
      message.ackedAt || null
    );
  }

  getMessage(id: string): Message | null {
    const row = this.db.prepare('SELECT * FROM im_messages WHERE id = ?').get(id) as MessageRow | undefined;
    return row ? this.rowToMessage(row) : null;
  }

  getInbox(address: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM im_messages WHERE to_address = ? ORDER BY created_at DESC'
    ).all(address) as MessageRow[];
    return rows.map(row => this.rowToMessage(row));
  }

  getPendingMessages(address: string): Message[] {
    const rows = this.db.prepare(
      'SELECT * FROM im_messages WHERE to_address = ? AND status != ? ORDER BY created_at ASC'
    ).all(address, 'acked') as MessageRow[];
    return rows.map(row => this.rowToMessage(row));
  }

  updateMessageStatus(id: string, status: MessageStatus): void {
    const now = new Date().toISOString();
    const updates: Record<string, string | null> = { status };

    if (status === 'delivered') {
      updates['delivered_at'] = now;
    } else if (status === 'acked') {
      updates['acked_at'] = now;
    }

    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), id];

    this.db.prepare(`UPDATE im_messages SET ${setClauses} WHERE id = ?`).run(...values);
  }

  // Agent operations
  saveAgent(agent: Agent): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO im_agents 
      (id, host, address, name, status, last_seen_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      agent.id,
      agent.host,
      agent.address,
      agent.name || null,
      agent.status,
      agent.lastSeenAt,
      agent.createdAt
    );
  }

  getAgentById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM im_agents WHERE id = ?').get(id) as AgentRow | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  getAgentByAddress(address: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM im_agents WHERE address = ?').get(address) as AgentRow | undefined;
    return row ? this.rowToAgent(row) : null;
  }

  updateAgentStatus(id: string, status: AgentStatus): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE im_agents SET status = ?, last_seen_at = ? WHERE id = ?').run(status, now, id);
  }

  private rowToMessage(row: MessageRow): Message {
    return {
      id: row.id,
      from: row.from_address,
      to: row.to_address,
      content: JSON.parse(row.content),
      status: row.status as MessageStatus,
      createdAt: row.created_at,
      deliveredAt: row.delivered_at || undefined,
      ackedAt: row.acked_at || undefined,
    };
  }

  private rowToAgent(row: AgentRow): Agent {
    return {
      id: row.id,
      host: row.host,
      address: row.address,
      name: row.name || undefined,
      status: row.status as AgentStatus,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
    };
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/db.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/db/index.ts tests/im/db.test.ts
git commit -m "feat(im): add database layer for Agent IM

- IMDatabase class with message and agent operations
- SQLite persistence using bun:sqlite
- Support message status tracking (pending/delivered/acked)"
```

---

## Phase 2: HTTP Server

### Task 3: HTTP API Routes

**Files:**
- Create: `src/im/server/http.ts`
- Create: `src/im/server/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/server.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { IMHTTPServer } from '../../src/im/server/http';
import { IMDatabase } from '../../src/im/db';
import type { Message } from '../../src/im/types';

describe('IMHTTPServer', () => {
  let db: IMDatabase;
  let server: IMHTTPServer;
  let baseUrl: string;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    server = new IMHTTPServer(db, 0);
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;
  });

  afterEach(async () => {
    await server.stop();
    db.close();
  });

  describe('POST /messages', () => {
    it('should send a message', async () => {
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Hello Bob' },
        }),
      });

      expect(response.status).toBe(201);
      const result = await response.json();
      expect(result.id).toBeDefined();
      expect(result.from).toBe('anonymous@server.com'); // Default sender
      expect(result.to).toBe('bob@server.com');
      expect(result.content).toEqual({ type: 'text', body: 'Hello Bob' });
      expect(result.status).toBe('pending');
    });

    it('should reject message without to address', async () => {
      const response = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: { type: 'text', body: 'Hello' },
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /messages', () => {
    it('should get inbox messages', async () => {
      // First send a message
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Test message' },
        }),
      });

      // Then get inbox
      const response = await fetch(`${baseUrl}/messages?address=bob@server.com`);
      const messages = await response.json();

      expect(Array.isArray(messages)).toBe(true);
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].to).toBe('bob@server.com');
    });
  });

  describe('POST /messages/ack', () => {
    it('should acknowledge messages', async () => {
      // Send a message
      const sendResponse = await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: 'bob@server.com',
          content: { type: 'text', body: 'Test' },
        }),
      });
      const { id } = await sendResponse.json();

      // Acknowledge
      const ackResponse = await fetch(`${baseUrl}/messages/ack`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: [id] }),
      });

      expect(ackResponse.status).toBe(200);

      // Verify status changed
      const msgResponse = await fetch(`${baseUrl}/messages/${id}`);
      const msg = await msgResponse.json();
      expect(msg.status).toBe('acked');
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const response = await fetch(`${baseUrl}/health`);
      expect(response.status).toBe(200);
      const health = await response.json();
      expect(health.status).toBe('ok');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/server.test.ts`
Expected: FAIL with "Cannot find module '../../src/im/server/http'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/server/http.ts
import type { IMDatabase } from '../db';
import type { Message, SendMessageInput, Content } from '../types';
import { v4 as uuidv4 } from 'uuid';

export class IMHTTPServer {
  private server?: any;
  private port: number;
  private db: IMDatabase;

  constructor(db: IMDatabase, port = 3001) {
    this.db = db;
    this.port = port;
  }

  async start(): Promise<void> {
    const db = this.db;
    const self = this;

    this.server = Bun.serve({
      port: this.port,
      async fetch(req: Request) {
        const url = new URL(req.url);
        const path = url.pathname;

        // Health check
        if (path === '/health') {
          return Response.json({ status: 'ok', timestamp: Date.now() });
        }

        // POST /messages - Send message
        if (path === '/messages' && req.method === 'POST') {
          try {
            const body = await req.json() as { to?: string; content?: Content; from?: string };
            
            if (!body.to || !body.content) {
              return Response.json(
                { error: { code: 'INVALID_REQUEST', message: 'to and content required' } },
                { status: 400 }
              );
            }

            const message: Message = {
              id: uuidv4(),
              from: body.from || 'anonymous@server.com',
              to: body.to,
              content: body.content,
              status: 'pending',
              createdAt: new Date().toISOString(),
            };

            db.saveMessage(message);
            return Response.json(message, { status: 201 });
          } catch (e) {
            return Response.json(
              { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } },
              { status: 400 }
            );
          }
        }

        // GET /messages - Get inbox
        if (path === '/messages' && req.method === 'GET') {
          const address = url.searchParams.get('address');
          
          if (!address) {
            return Response.json(
              { error: { code: 'INVALID_REQUEST', message: 'address query param required' } },
              { status: 400 }
            );
          }

          const messages = db.getInbox(address);
          return Response.json(messages);
        }

        // GET /messages/:id - Get single message
        if (path.startsWith('/messages/') && req.method === 'GET') {
          const id = path.split('/')[2];
          const message = db.getMessage(id);

          if (!message) {
            return Response.json(
              { error: { code: 'MESSAGE_NOT_FOUND', message: `Message ${id} not found` } },
              { status: 404 }
            );
          }

          return Response.json(message);
        }

        // POST /messages/ack - Acknowledge messages
        if (path === '/messages/ack' && req.method === 'POST') {
          try {
            const body = await req.json() as { messageIds?: string[] };

            if (!body.messageIds || !Array.isArray(body.messageIds)) {
              return Response.json(
                { error: { code: 'INVALID_REQUEST', message: 'messageIds array required' } },
                { status: 400 }
              );
            }

            body.messageIds.forEach(id => {
              db.updateMessageStatus(id, 'acked');
            });

            return Response.json({ success: true, acked: body.messageIds.length });
          } catch (e) {
            return Response.json(
              { error: { code: 'INVALID_REQUEST', message: 'Invalid JSON body' } },
              { status: 400 }
            );
          }
        }

        return Response.json(
          { error: { code: 'NOT_FOUND', message: 'Route not found' } },
          { status: 404 }
        );
      },
    });
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = undefined;
    }
  }

  getPort(): number {
    return this.port;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/server/http.ts tests/im/server.test.ts
git commit -m "feat(im): add HTTP server for Agent IM

- POST /messages - Send message
- GET /messages?address= - Get inbox
- GET /messages/:id - Get single message
- POST /messages/ack - Acknowledge messages
- GET /health - Health check"
```

---

## Phase 3: WebSocket Server

### Task 4: WebSocket Handler

**Files:**
- Create: `src/im/server/ws.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/ws.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { IMWebSocketServer } from '../../src/im/server/ws';
import { IMHTTPServer } from '../../src/im/server/http';
import { IMDatabase } from '../../src/im/db';

describe('IMWebSocketServer', () => {
  let db: IMDatabase;
  let httpServer: IMHTTPServer;
  let wsServer: IMWebSocketServer;
  let baseUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    httpServer = new IMHTTPServer(db, 0);
    await httpServer.start();
    
    const port = httpServer.getPort();
    baseUrl = `http://localhost:${port}`;
    wsUrl = `ws://localhost:${port}/ws`;

    wsServer = new IMWebSocketServer(httpServer, db, port);
    await wsServer.start();
  });

  afterEach(async () => {
    wsServer.stop();
    await httpServer.stop();
    db.close();
  });

  describe('WebSocket Connection', () => {
    it('should connect and receive messages', async () => {
      const ws = new WebSocket(wsUrl);
      
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
      });

      // Wait for connected event
      const event = await waitForEvent(ws, 'connected');
      expect(event.data.address).toBeDefined();

      ws.close();
    });

    it('should receive pushed messages when online', async () => {
      // Connect Bob
      const bobWs = new WebSocket(wsUrl);
      const bobEvent = await waitForEvent(bobWs, 'connected');
      const bobAddress = bobEvent.data.address;

      // Send message to Bob via HTTP
      await fetch(`${baseUrl}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: bobAddress,
          content: { type: 'text', body: 'Hello Bob!' },
        }),
      });

      // Bob should receive the message
      const msgEvent = await waitForEvent(bobWs, 'message', 2000);
      expect(msgEvent.data.content).toEqual({ type: 'text', body: 'Hello Bob!' });

      // Acknowledge
      bobWs.send(JSON.stringify({
        event: 'ack',
        data: { messageId: msgEvent.data.id },
      }));

      bobWs.close();
    });
  });
});

// Helper to wait for specific event
function waitForEvent(ws: WebSocket, eventName: string, timeout = 1000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for event: ${eventName}`));
    }, timeout);

    ws.addEventListener(eventName, (e: any) => {
      clearTimeout(timer);
      resolve(JSON.parse(e.data));
    });

    ws.addEventListener('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/ws.test.ts`
Expected: FAIL with "Cannot find module '../../src/im/server/ws'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/server/ws.ts
import { WebSocket, WebSocketServer as WSS } from 'ws';
import type { IMHTTPServer } from './http';
import type { IMDatabase } from '../db';
import type { Message } from '../types';

interface WSMessage {
  event: string;
  data?: any;
}

export class IMWebSocketServer {
  private wss?: WSS;
  private clients: Map<string, WebSocket> = new Map();
  private httpServer: IMHTTPServer;
  private db: IMDatabase;
  private heartbeatInterval?: Timer;

  constructor(httpServer: IMHTTPServer, db: IMDatabase, port: number) {
    this.httpServer = httpServer;
    this.db = db;
    
    // Get the underlying Bun server for WebSocket upgrade
    const server = (httpServer as any).server;
    if (server) {
      this.wss = new WSS({ server });
    }
  }

  async start(): Promise<void> {
    if (!this.wss) return;

    const db = this.db;
    const clients = this.clients;

    this.wss.on('connection', (ws: WebSocket, req: Request) => {
      const url = new URL(req.url, 'http://localhost');
      const address = url.searchParams.get('address') || `anonymous-${Date.now()}@server.com`;

      // Register client
      clients.set(address, ws);

      // Update agent status
      db.saveAgent({
        id: address,
        host: url.host,
        address,
        status: 'online',
        lastSeenAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      });

      // Send connected event
      ws.send(JSON.stringify({
        event: 'connected',
        data: { address },
      }));

      // Send pending messages
      const pending = db.getPendingMessages(address);
      pending.forEach(msg => {
        db.updateMessageStatus(msg.id, 'delivered');
        ws.send(JSON.stringify({
          event: 'message',
          data: msg,
        }));
      });

      // Handle incoming messages
      ws.addEventListener('message', (e: any) => {
        try {
          const msg: WSMessage = JSON.parse(e.data);
          handleWSMessage(ws, address, msg, db);
        } catch (err) {
          ws.send(JSON.stringify({
            event: 'error',
            data: { message: 'Invalid JSON' },
          }));
        }
      });

      // Handle close
      ws.addEventListener('close', () => {
        clients.delete(address);
        db.updateAgentStatus(address, 'offline');
      });
    });

    // Heartbeat check
    this.heartbeatInterval = setInterval(() => {
      clients.forEach((ws, address) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
          db.updateAgentStatus(address, 'online');
        }
      });
    }, 30000).ref();
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    this.clients.forEach(ws => ws.close());
    this.clients.clear();
    if (this.wss) {
      this.wss.close();
    }
  }

  // Push message to specific address
  pushMessage(address: string, message: Message): void {
    const ws = this.clients.get(address);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        event: 'message',
        data: message,
      }));
    }
  }
}

function handleWSMessage(ws: WebSocket, address: string, msg: WSMessage, db: IMDatabase): void {
  switch (msg.event) {
    case 'ping':
      ws.send(JSON.stringify({ event: 'pong' }));
      break;

    case 'ack':
      if (msg.data?.messageId) {
        db.updateMessageStatus(msg.data.messageId, 'acked');
      } else if (msg.data?.messageIds && Array.isArray(msg.data.messageIds)) {
        msg.data.messageIds.forEach((id: string) => {
          db.updateMessageStatus(id, 'acked');
        });
      }
      break;

    default:
      ws.send(JSON.stringify({
        event: 'error',
        data: { message: `Unknown event: ${msg.event}` },
      }));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/ws.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/server/ws.ts tests/im/ws.test.ts
git commit -m "feat(im): add WebSocket server for real-time messaging

- WebSocket connection with address authentication
- Real-time message push to connected clients
- ACK handling for At-Least-Once delivery
- Heartbeat for connection status"
```

---

## Phase 4: Client SDK

### Task 5: Mailbox Client

**Files:**
- Create: `src/im/client/mailbox.ts`
- Create: `src/im/client/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/client.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Mailbox } from '../../src/im/client/mailbox';
import { IMHTTPServer } from '../../src/im/server/http';
import { IMWebSocketServer } from '../../src/im/server/ws';
import { IMDatabase } from '../../src/im/db';

describe('Mailbox Client', () => {
  let db: IMDatabase;
  let httpServer: IMHTTPServer;
  let wsServer: IMWebSocketServer;
  let aliceMailbox: Mailbox;
  let bobMailbox: Mailbox;
  let baseUrl: string;

  beforeEach(async () => {
    db = new IMDatabase({ memory: true });
    httpServer = new IMHTTPServer(db, 0);
    await httpServer.start();
    
    const port = httpServer.getPort();
    baseUrl = `http://localhost:${port}`;

    wsServer = new IMWebSocketServer(httpServer, db, port);
    await wsServer.start();

    aliceMailbox = new Mailbox({
      address: 'alice@server.com',
      serverUrl: baseUrl,
    });

    bobMailbox = new Mailbox({
      address: 'bob@server.com',
      serverUrl: baseUrl,
    });
  });

  afterEach(async () => {
    await aliceMailbox.disconnect();
    await bobMailbox.disconnect();
    wsServer.stop();
    await httpServer.stop();
    db.close();
  });

  describe('Connection', () => {
    it('should connect to server', async () => {
      await aliceMailbox.connect();
      expect(aliceMailbox.isConnected()).toBe(true);
    });

    it('should receive connection confirmation', async () => {
      const connected = await aliceMailbox.connect();
      expect(connected).toBe(true);
    });
  });

  describe('Send and Receive', () => {
    it('should send message to another agent', async () => {
      await aliceMailbox.connect();
      await bobMailbox.connect();

      const receivedPromise = new Promise<any>((resolve) => {
        bobMailbox.on('message', (msg) => resolve(msg));
      });

      await aliceMailbox.send('bob@server.com', {
        type: 'text',
        body: 'Hello Bob!',
      });

      const received = await receivedPromise;
      expect(received.content).toEqual({ type: 'text', body: 'Hello Bob!' });
    });

    it('should send image message', async () => {
      await aliceMailbox.connect();

      await aliceMailbox.send('bob@server.com', {
        type: 'image',
        body: {
          url: 'https://example.com/photo.jpg',
          width: 1920,
          height: 1080,
          format: 'jpeg',
        },
      });
    });

    it('should receive multiple messages in order', async () => {
      await aliceMailbox.connect();
      await bobMailbox.connect();

      const messages: any[] = [];
      bobMailbox.on('message', (msg) => {
        messages.push(msg);
      });

      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 1' });
      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 2' });
      await aliceMailbox.send('bob@server.com', { type: 'text', body: 'Msg 3' });

      // Wait for all messages
      await new Promise(resolve => setTimeout(resolve, 500));
      expect(messages.length).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/client.test.ts`
Expected: FAIL with "Cannot find module '../../src/im/client/mailbox'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/client/mailbox.ts
import type { Message, Content } from '../types';

export interface MailboxConfig {
  address: string;
  serverUrl: string;
  wsPath?: string;
}

type MessageHandler = (message: Message) => void;

export class Mailbox {
  private ws?: WebSocket;
  private config: MailboxConfig;
  private messageHandlers: MessageHandler[] = [];
  private connected = false;
  private reconnectTimer?: Timer;
  private pendingAcks: Set<string> = new Set();

  constructor(config: MailboxConfig) {
    this.config = {
      wsPath: '/ws',
      ...config,
    };
  }

  async connect(): Promise<boolean> {
    if (this.connected) return true;

    const wsUrl = `${this.config.serverUrl.replace('http', 'ws')}${this.config.wsPath}?address=${encodeURIComponent(this.config.address)}`;

    return new Promise((resolve) => {
      this.ws = new WebSocket(wsUrl);

      this.ws.addEventListener('open', () => {
        this.connected = true;
        resolve(true);
      });

      this.ws.addEventListener('message', (e: any) => {
        try {
          const msg = JSON.parse(e.data);
          this.handleServerMessage(msg);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      });

      this.ws.addEventListener('close', () => {
        this.connected = false;
        this.scheduleReconnect();
      });

      this.ws.addEventListener('error', () => {
        this.connected = false;
        resolve(false);
      });
    });
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  on(event: 'message', handler: MessageHandler): void {
    if (event === 'message') {
      this.messageHandlers.push(handler);
    }
  }

  off(event: 'message', handler: MessageHandler): void {
    if (event === 'message') {
      const index = this.messageHandlers.indexOf(handler);
      if (index !== -1) {
        this.messageHandlers.splice(index, 1);
      }
    }
  }

  async send(to: string, content: Content): Promise<Message> {
    const response = await fetch(`${this.config.serverUrl}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.config.address,
        to,
        content,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to send message: ${response.status}`);
    }

    return response.json();
  }

  async ack(messageId: string): Promise<void> {
    if (this.ws && this.connected) {
      this.ws.send(JSON.stringify({
        event: 'ack',
        data: { messageId },
      }));
    }

    await fetch(`${this.config.serverUrl}/messages/ack`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageIds: [messageId] }),
    });
  }

  async fetchInbox(): Promise<Message[]> {
    const response = await fetch(`${this.config.serverUrl}/messages?address=${encodeURIComponent(this.config.address)}`);
    return response.json();
  }

  private handleServerMessage(msg: any): void {
    switch (msg.event) {
      case 'connected':
        console.log(`Connected as ${msg.data.address}`);
        break;

      case 'message':
        // Notify handlers
        this.messageHandlers.forEach(handler => handler(msg.data));
        break;

      case 'pong':
        // Heartbeat response
        break;

      case 'error':
        console.error('Server error:', msg.data.message);
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      await this.connect();
    }, 5000);
  }
}
```

```typescript
// src/im/client/index.ts
export { Mailbox, type MailboxConfig } from './mailbox';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/client/mailbox.ts src/im/client/index.ts tests/im/client.test.ts
git commit -m "feat(im): add Mailbox client SDK

- Mailbox class for agent communication
- WebSocket connection with auto-reconnect
- Send/receive messages
- ACK support for At-Least-Once delivery"
```

---

## Phase 5: CLI and Server Entry Point

### Task 6: Server Entry Point

**Files:**
- Create: `src/im/server/index.ts`
- Create: `src/im/index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/integration.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { createIMServer } from '../../src/im/server';

describe('IMServer Integration', () => {
  let server: any;

  beforeEach(async () => {
    server = await createIMServer({ port: 0, dbPath: ':memory:' });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should start and respond to health check', async () => {
    const response = await fetch(`http://localhost:${server.port}/health`);
    expect(response.status).toBe(200);
    const health = await response.json();
    expect(health.status).toBe('ok');
  });

  it('should handle full send/receive flow', async () => {
    // Connect Alice
    const aliceWs = new WebSocket(`ws://localhost:${server.port}/ws?address=alice@server.com`);
    await new Promise(resolve => aliceWs.onopen = resolve);

    // Connect Bob
    const bobWs = new WebSocket(`ws://localhost:${server.port}/ws?address=bob@server.com`);
    await new Promise(resolve => bobWs.onopen = resolve);

    // Wait for connections
    await new Promise(resolve => setTimeout(resolve, 100));

    // Send message
    const response = await fetch(`http://localhost:${server.port}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'alice@server.com',
        to: 'bob@server.com',
        content: { type: 'text', body: 'Test message' },
      }),
    });

    expect(response.status).toBe(201);

    // Bob receives message
    const msgEvent = await new Promise<any>(resolve => {
      bobWs.onmessage = (e: any) => resolve(JSON.parse(e.data));
    });

    expect(msgEvent.event).toBe('message');
    expect(msgEvent.data.content).toEqual({ type: 'text', body: 'Test message' });

    aliceWs.close();
    bobWs.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/integration.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/server/index.ts
import { IMHTTPServer } from './http';
import { IMWebSocketServer } from './ws';
import { IMDatabase } from '../db';

export interface IMServerConfig {
  port?: number;
  dbPath?: string;
  host?: string;
}

export async function createIMServer(config: IMServerConfig = {}): Promise<{
  httpServer: IMHTTPServer;
  wsServer: IMWebSocketServer;
  db: IMDatabase;
  stop: () => Promise<void>;
  port: number;
}> {
  const db = new IMDatabase({
    path: config.dbPath,
    memory: config.dbPath === ':memory:',
  });

  const httpServer = new IMHTTPServer(db, config.port || 3001);
  await httpServer.start();

  const port = httpServer.getPort();
  const wsServer = new IMWebSocketServer(httpServer, db, port);
  await wsServer.start();

  return {
    httpServer,
    wsServer,
    db,
    port,
    async stop() {
      wsServer.stop();
      await httpServer.stop();
      db.close();
    },
  };
}
```

```typescript
// src/im/index.ts
// Types
export type { Message, Agent, Content, MessageStatus, AgentStatus } from './types';
export type { TextContent, ImageContent, MixedContent, JsonContent, FileContent } from './types';

// Server
export { IMHTTPServer } from './server/http';
export { IMWebSocketServer } from './server/ws';
export { createIMServer, type IMServerConfig } from './server/index';
export { IMDatabase, type IMDatabaseConfig } from './db';

// Client
export { Mailbox, type MailboxConfig } from './client';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/integration.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/server/index.ts src/im/index.ts tests/im/integration.test.ts
git commit -m "feat(im): add server entry point and exports

- createIMServer factory function
- Module exports for types, server, client
- Integration tests"
```

---

### Task 7: CLI Commands

**Files:**
- Create: `src/im/cli/index.ts`
- Create: `tests/im/cli.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/im/cli.test.ts
import { describe, it, expect, beforeEach } from 'bun:test';
import { IMCLI } from '../../src/im/cli';

describe('IMCLI', () => {
  let cli: IMCLI;

  beforeEach(() => {
    cli = new IMCLI({
      serverUrl: 'http://localhost:3001',
      address: 'alice@server.com',
    });
  });

  describe('send command', () => {
    it('should format send command correctly', () => {
      const cmd = cli.formatSendCommand('bob@server.com', 'Hello Bob!');
      expect(cmd).toContain('bob@server.com');
      expect(cmd).toContain('Hello Bob!');
    });
  });

  describe('address validation', () => {
    it('should validate address format', () => {
      expect(cli.isValidAddress('alice@server.com')).toBe(true);
      expect(cli.isValidAddress('alice-bob@server.com')).toBe(true);
      expect(cli.isValidAddress('invalid-address')).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/im/cli.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/im/cli/index.ts
import { Mailbox, type MailboxConfig } from '../client';

export interface CLIConfig {
  serverUrl: string;
  address: string;
}

export class IMCLI {
  private mailbox: Mailbox;
  private config: CLIConfig;

  constructor(config: CLIConfig) {
    this.config = config;
    this.mailbox = new Mailbox({
      address: config.address,
      serverUrl: config.serverUrl,
    });
  }

  async send(to: string, content: { type: string; body: any }): Promise<void> {
    await this.mailbox.connect();
    await this.mailbox.send(to, content as any);
  }

  async startListening(onMessage: (msg: any) => void): Promise<void> {
    await this.mailbox.connect();
    this.mailbox.on('message', onMessage);
  }

  isValidAddress(address: string): boolean {
    return /^[\w-]+@[\w.-]+$/.test(address);
  }

  formatSendCommand(to: string, body: string): string {
    return `Sending to ${to}: ${body}`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test tests/im/cli.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/im/cli/index.ts tests/im/cli.test.ts
git commit -m "feat(im): add CLI interface for Agent IM"
```

---

## Phase 6: Cleanup Old Mail Code

### Task 8: Remove Old Mailbox Code

**Files:**
- Delete: `src/lib/mail/`, `src/lib/com/`, `src/lib/mailbox/`
- Modify: `src/index.ts`
- Modify: `src/cli/commands/com/` (remove)
- Delete: `tests/bounty-mail-service.test.ts`, `tests/mail-queue.test.ts`, `tests/mailbox/`

- [ ] **Step 1: Remove old directories**

```bash
rm -rf src/lib/mail src/lib/com src/lib/mailbox
rm -rf tests/bounty-mail-service.test.ts tests/mail-queue.test.ts tests/mailbox
rm -rf src/cli/commands/com
```

- [ ] **Step 2: Update exports**

```bash
git add -A
git commit -m "refactor: remove old mailbox/mail/com code

- Delete src/lib/mail, src/lib/com, src/lib/mailbox
- Delete old tests
- CLI commands will be re-added with new IM commands"
```

---

## Self-Review Checklist

- [ ] All spec requirements have corresponding tasks
- [ ] No placeholders (TBD, TODO)
- [ ] Type consistency across tasks
- [ ] Tests use TDD (fail first)
- [ ] Each task ends with a commit

---

**Plan complete and saved to `docs/superpowers/plans/2025-01-15-agent-im-implementation.md`**

**Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
