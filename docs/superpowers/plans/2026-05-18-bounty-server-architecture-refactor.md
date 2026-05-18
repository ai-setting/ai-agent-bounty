# Bounty Server 架构重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重构 bounty-server 架构，清晰展示 Auth、Bounty、IM 三大能力，支持 .env 端口配置

**Architecture:** 
1. 创建 `src/server/` 目录，重命名 `IMHTTPServer` → `BountyHTTPServer`，`IMWebSocketServer` → `BountyWebSocketServer`
2. 拆分路由到独立模块：`AuthRoutes`、`BountyRoutes`、`IMRoutes`
3. 使用环境变量配置端口，支持默认值

**Tech Stack:** Bun, TypeScript, SQLite

---

## 文件结构

```
src/
├── server/                          # 新建目录
│   ├── index.ts                     # 导出 BountyServer
│   ├── http/
│   │   ├── index.ts                 # BountyHTTPServer
│   │   ├── auth-routes.ts           # Auth 路由
│   │   ├── bounty-routes.ts        # Bounty 任务路由
│   │   └── im-routes.ts            # IM 消息路由
│   └── ws/
│       └── index.ts                 # BountyWebSocketServer
├── im/                              # 保留（作为子模块）
│   ├── db/
│   ├── client/
│   └── eventsource/
└── index.ts                         # 更新导出

start-server.ts                      # 使用环境变量
scripts/start-im-server.ts           # 更新
.env.example                         # 更新
```

---

## Task 1: 创建 src/server/ 目录和入口文件

**Files:**
- Create: `src/server/index.ts`
- Modify: `src/index.ts:22-27`

- [ ] **Step 1: 创建目录结构**

```bash
mkdir -p src/server/http src/server/ws
```

- [ ] **Step 2: 创建 src/server/index.ts**

```typescript
/**
 * Bounty Server
 * 
 * Core server module providing:
 * - Auth: Authentication and agent management
 * - Bounty: Task publishing, grabbing, completion
 * - IM: Agent messaging
 */

export { BountyHTTPServer } from './http/index.js';
export { BountyWebSocketServer } from './ws/index.js';
export { type BountyServerConfig } from './http/index.js';
```

- [ ] **Step 3: 更新 src/index.ts 导出**

找到 `index.ts:22-27` 行，更新为：

```typescript
// Server (Bounty Business + Auth + IM)
export { BountyHTTPServer } from './server/http/index.js';
export { BountyWebSocketServer } from './server/ws/index.js';

// IM Submodule (Database, Client, EventSource)
export { createIMServer, type IMServerConfig } from './im/server/index.js';
export { IMDatabase } from './im/db/index.js';
export { Mailbox, type MailboxConfig } from './im/client/index.js';
export type { Message, Agent as IMAgent, Content } from './im/types.js';
```

- [ ] **Step 4: 提交**

```bash
git add src/server/ src/index.ts
git commit -m "feat: create src/server/ directory structure"
```

---

## Task 2: 创建 BountyHTTPServer (重命名 + 重构)

**Files:**
- Create: `src/server/http/index.ts` (原 `src/im/server/http.ts`)
- Modify: `src/im/server/http.ts` (保留向后兼容)

- [ ] **Step 1: 创建 src/server/http/index.ts**

```typescript
/**
 * Bounty HTTP Server
 * 
 * Provides REST API for:
 * - Auth: /api/auth/* (public)
 * - Agents: /api/agents/* (protected)
 * - Bounty Tasks: /api/tasks/* (protected)
 * - IM Messages: /api/messages/* (protected)
 * - Legacy: /health, /messages (public)
 */

import type { IMDatabase } from '../../im/db';
import type { Database } from '../../lib/storage/database';
import { AuthRoutes } from './auth-routes.js';
import { BountyRoutes } from './bounty-routes.js';
import { IMRoutes } from './im-routes.js';
import type { Content } from '../../im/types';

export interface BountyServerConfig {
  /** IM Database instance */
  imDb: IMDatabase;
  /** Bounty Database instance (optional, enables full functionality) */
  bountyDb?: Database;
  /** HTTP server port, default: 4002 */
  port?: number;
}

type PushCallback = (address: string, message: any) => void;

export class BountyHTTPServer {
  private imDb: IMDatabase;
  private bountyDb: Database | null = null;
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private pushCallback: PushCallback | null = null;

  // Route handlers
  private authRoutes: AuthRoutes;
  private bountyRoutes: BountyRoutes;
  private imRoutes: IMRoutes;

  constructor(config: BountyServerConfig) {
    this.imDb = config.imDb;
    this.bountyDb = config.bountyDb || null;
    this.port = config.port ?? 4002;

    // Initialize route handlers
    this.authRoutes = new AuthRoutes(this.bountyDb!);
    this.bountyRoutes = new BountyRoutes(this.bountyDb!);
    this.imRoutes = new IMRoutes(this.imDb, (to, msg) => this.pushCallback?.(to, msg));
  }

  setPushCallback(callback: PushCallback): void {
    this.pushCallback = callback;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req) => this.handleRequest(req),
    });
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.server?.port ?? this.port;
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // === Auth Routes (public) ===
      if (method === 'POST' && path === '/api/auth/register') {
        return await this.authRoutes.register(req);
      }
      if (method === 'POST' && path === '/api/auth/verify') {
        return await this.authRoutes.verify(req);
      }
      if (method === 'POST' && path === '/api/auth/login') {
        return await this.authRoutes.login(req);
      }
      if (method === 'POST' && path === '/api/auth/send-code') {
        return await this.authRoutes.sendCode(req);
      }

      // === Protected Routes (require auth) ===
      if (this.bountyDb) {
        const authResult = await this.checkAuth(req);
        if (authResult.error) {
          return authResult.error;
        }
        const agentId = authResult.agentId!;

        // Agent routes
        if (method === 'GET' && path === '/api/agents/me') {
          return this.authRoutes.getCurrentAgent(agentId);
        }
        if (method === 'GET' && path === '/api/agents/me/credits') {
          return this.authRoutes.getCurrentAgentCredits(agentId);
        }
        if (method === 'GET' && path === '/api/agents') {
          return this.authRoutes.listAgents();
        }
        if (method === 'GET' && path.startsWith('/api/agents/') && path !== '/api/agents/me') {
          const id = path.slice('/api/agents/'.length);
          return this.authRoutes.getAgentById(id);
        }
        if (method === 'DELETE' && path.startsWith('/api/agents/')) {
          const id = path.slice('/api/agents/'.length);
          return this.authRoutes.deleteAgent(id, agentId);
        }

        // Bounty routes
        if (method === 'GET' && path === '/api/tasks') {
          return this.bountyRoutes.getTasks();
        }
        if (method === 'POST' && path === '/api/tasks') {
          return await this.bountyRoutes.createTask(req, agentId);
        }
        if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/grab')) {
          const id = path.slice('/api/tasks/'.length, -'/grab'.length);
          return this.bountyRoutes.grabTask(id, agentId);
        }
        if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/submit')) {
          const id = path.slice('/api/tasks/'.length, -'/submit'.length);
          return await this.bountyRoutes.submitTask(req, id, agentId);
        }

        // IM routes (protected)
        if (method === 'GET' && path === '/api/messages') {
          return this.imRoutes.getMessages(url);
        }
        if (method === 'POST' && path === '/api/messages') {
          return await this.imRoutes.sendMessage(req);
        }
        if (method === 'GET' && path.startsWith('/api/messages/')) {
          const id = path.slice('/api/messages/'.length);
          return this.imRoutes.getMessageById(id);
        }
        if (method === 'POST' && path === '/api/messages/ack') {
          return await this.imRoutes.ackMessages(req);
        }
      }

      // === Legacy Public Routes ===
      if (method === 'GET' && path === '/health') {
        return Response.json({ status: 'ok', timestamp: Date.now() });
      }
      if (method === 'POST' && path === '/messages') {
        return await this.imRoutes.sendMessage(req);
      }
      if (method === 'GET' && path === '/messages') {
        return this.imRoutes.getMessages(url);
      }
      if (method === 'GET' && path.startsWith('/messages/')) {
        const id = path.slice('/messages/'.length);
        return this.imRoutes.getMessageById(id);
      }
      if (method === 'POST' && path === '/messages/ack') {
        return await this.imRoutes.ackMessages(req);
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      console.error('Request error:', err);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  private async checkAuth(req: Request): Promise<{ agentId?: string; error?: Response }> {
    const authHeader = req.headers.get('authorization');

    if (!authHeader) {
      return { error: Response.json({ error: 'Authorization header required' }, { status: 401 }) };
    }

    if (!authHeader.startsWith('Bearer ')) {
      return { error: Response.json({ error: 'Invalid authorization format. Use: Bearer <token>' }, { status: 401 }) };
    }

    const token = authHeader.slice(7);

    try {
      const { verifyToken } = await import('../../auth/jwt');
      const payload = await verifyToken(token);
      return { agentId: payload.sub };
    } catch (error: any) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        return { error: Response.json({ error: 'Token expired' }, { status: 401 }) };
      }
      return { error: Response.json({ error: 'Invalid token' }, { status: 401 }) };
    }
  }
}
```

- [ ] **Step 2: 更新 src/im/server/http.ts 保留向后兼容**

在原文件开头添加：

```typescript
/**
 * @deprecated Use 'server/http/index.ts' instead
 */
export { BountyHTTPServer } from '../../server/http/index.js';
import { BountyHTTPServer as NewServer } from '../../server/http/index.js';
export const IMHTTPServer = NewServer;
```

- [ ] **Step 3: 提交**

```bash
git add src/server/http/index.ts src/im/server/http.ts
git commit -m "feat: create BountyHTTPServer with modular routes"
```

---

## Task 3: 创建 AuthRoutes

**Files:**
- Create: `src/server/http/auth-routes.ts`

- [ ] **Step 1: 创建 src/server/http/auth-routes.ts**

```typescript
/**
 * Auth Routes
 * 
 * Handles authentication endpoints:
 * - POST /api/auth/register
 * - POST /api/auth/verify
 * - POST /api/auth/login
 * - POST /api/auth/send-code
 */

import type { Database } from '../../lib/storage/database';
import { register, verify, login, sendVerificationCode } from '../../auth/service.js';

export class AuthRoutes {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async register(req: Request): Promise<Response> {
    try {
      let input: { email?: string; name?: string; description?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.name) {
        return Response.json({ error: 'Email and name are required' }, { status: 400 });
      }
      
      if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(input.email)) {
        return Response.json({ error: 'Invalid email format' }, { status: 400 });
      }
      
      const result = await register(this.db, {
        email: input.email!,
        name: input.name!,
        description: input.description
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  async verify(req: Request): Promise<Response> {
    try {
      let input: { email?: string; code?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.code) {
        return Response.json({ error: 'Email and code are required' }, { status: 400 });
      }
      
      const result = await verify(this.db, {
        email: input.email!,
        code: input.code!
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  async login(req: Request): Promise<Response> {
    try {
      let input: { email?: string; agent_id?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email && !input.agent_id) {
        return Response.json({ error: 'Email or agent_id is required' }, { status: 400 });
      }
      
      const result = await login(this.db, {
        email: input.email,
        agent_id: input.agent_id
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      return Response.json({ error: message }, { status: 401 });
    }
  }

  async sendCode(req: Request): Promise<Response> {
    try {
      let input: { email?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email) {
        return Response.json({ error: 'Email is required' }, { status: 400 });
      }
      
      await sendVerificationCode(this.db, input.email);
      return Response.json({ message: 'Verification code sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  getCurrentAgent(agentId: string): Response {
    if (!this.db) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }
    return Response.json(agent);
  }

  getCurrentAgentCredits(agentId: string): Response {
    if (!this.db) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const transactions = this.db.prepare(`
      SELECT * FROM credit_transactions 
      WHERE agent_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(agentId);

    return Response.json({
      credits: agent.credits,
      transactions
    });
  }

  listAgents(): Response {
    if (!this.db) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const agents = this.db.prepare(`
      SELECT id, name, email, status, credits, address, description, created_at, updated_at
      FROM agents
      ORDER BY created_at DESC
    `).all();

    return Response.json(agents);
  }

  getAgentById(id: string): Response {
    if (!this.db) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const agent = this.db.prepare(`
      SELECT id, name, email, status, credits, address, description, created_at, updated_at
      FROM agents WHERE id = ?
    `).get(id);

    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    return Response.json(agent);
  }

  deleteAgent(id: string, requesterId: string): Response {
    if (!this.db) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (id === requesterId) {
      return Response.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    this.db.prepare('DELETE FROM credit_transactions WHERE agent_id = ?').run(id);
    this.db.prepare('DELETE FROM verifications WHERE agent_id = ?').run(id);
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);

    return Response.json({ message: 'Agent deleted successfully' });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/server/http/auth-routes.ts
git commit -m "feat: create AuthRoutes for auth endpoints"
```

---

## Task 4: 创建 BountyRoutes

**Files:**
- Create: `src/server/http/bounty-routes.ts`

- [ ] **Step 1: 创建 src/server/http/bounty-routes.ts**

```typescript
/**
 * Bounty Routes
 * 
 * Handles Bounty task endpoints:
 * - GET /api/tasks - List tasks
 * - POST /api/tasks - Create task
 * - PUT /api/tasks/:id/grab - Grab task
 * - PUT /api/tasks/:id/submit - Submit task result
 */

import type { Database } from '../../lib/storage/database';

export class BountyRoutes {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  getTasks(): Response {
    const tasks = this.db.prepare(`
      SELECT * FROM tasks ORDER BY created_at DESC
    `).all();

    return Response.json(tasks);
  }

  async createTask(req: Request, agentId: string): Promise<Response> {
    let body: { title?: string; description?: string; reward?: number; type?: string };
    try {
      const text = await req.text();
      if (!text) {
        return Response.json({ error: 'Missing request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { title, description, reward, type } = body;

    if (!title || !description || !reward) {
      return Response.json({ error: 'Missing required fields: title, description, reward' }, { status: 400 });
    }

    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Date.now();
    const taskId = crypto.randomUUID();

    this.db.prepare(`
      INSERT INTO tasks (id, title, description, type, reward, publisher_id, publisher_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(taskId, title, description, type || 'bounty', reward, agentId, agent.email, now, now);

    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(task, { status: 201 });
  }

  grabTask(taskId: string, agentId: string): Response {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'open') {
      return Response.json({ error: 'Task is not open' }, { status: 400 });
    }

    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE tasks SET assignee_id = ?, assignee_email = ?, status = 'in_progress', updated_at = ?
      WHERE id = ?
    `).run(agentId, agent.email, now, taskId);

    const updatedTask = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(updatedTask);
  }

  async submitTask(req: Request, taskId: string, agentId: string): Promise<Response> {
    let body: { result?: string };
    try {
      const text = await req.text();
      body = JSON.parse(text || '{}');
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const task = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.assignee_id !== agentId) {
      return Response.json({ error: 'Not authorized to submit this task' }, { status: 403 });
    }

    const now = Date.now();
    this.db.prepare(`
      UPDATE tasks SET result = ?, status = 'submitted', updated_at = ?
      WHERE id = ?
    `).run(body.result || '', now, taskId);

    const updatedTask = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(updatedTask);
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/server/http/bounty-routes.ts
git commit -m "feat: create BountyRoutes for task endpoints"
```

---

## Task 5: 创建 IMRoutes

**Files:**
- Create: `src/server/http/im-routes.ts`

- [ ] **Step 1: 创建 src/server/http/im-routes.ts**

```typescript
/**
 * IM Routes
 * 
 * Handles IM message endpoints:
 * - GET /api/messages - Get messages
 * - POST /api/messages - Send message
 * - GET /api/messages/:id - Get message by id
 * - POST /api/messages/ack - Acknowledge messages
 */

import type { IMDatabase } from '../../im/db';
import type { Message, Content } from '../../im/types';

export class IMRoutes {
  private db: IMDatabase;
  private pushCallback: ((address: string, message: Message) => void) | null;

  constructor(db: IMDatabase, pushCallback?: (address: string, message: Message) => void) {
    this.db = db;
    this.pushCallback = pushCallback || null;
  }

  setPushCallback(callback: (address: string, message: Message) => void): void {
    this.pushCallback = callback;
  }

  async sendMessage(req: Request): Promise<Response> {
    let body: { from?: string; to?: string; content?: Content };

    try {
      const text = await req.text();
      if (!text) {
        return Response.json({ error: 'Missing request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { to, content } = body;

    if (!to) {
      return Response.json({ error: 'Missing required field: to' }, { status: 400 });
    }

    if (!content) {
      return Response.json({ error: 'Missing required field: content' }, { status: 400 });
    }

    const message: Message = {
      id: crypto.randomUUID(),
      from: body.from || 'anonymous@server.com',
      to,
      content,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.db.saveMessage(message);

    // Push message to recipient if they are connected via WebSocket
    if (this.pushCallback) {
      this.pushCallback(to, message);
    }

    return Response.json(message, { status: 201 });
  }

  getMessages(url: URL): Response {
    const address = url.searchParams.get('address');

    if (!address) {
      return Response.json([]);
    }

    const messages = this.db.getInbox(address);
    return Response.json(messages);
  }

  getMessageById(id: string): Response {
    const message = this.db.getMessage(id);

    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    return Response.json(message);
  }

  async ackMessages(req: Request): Promise<Response> {
    let body: { messageIds?: string[] };

    try {
      const text = await req.text();
      if (!text) {
        return Response.json({ error: 'Missing request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (!body.messageIds || !Array.isArray(body.messageIds)) {
      return Response.json({ error: 'Missing required field: messageIds' }, { status: 400 });
    }

    let acked = 0;
    for (const id of body.messageIds) {
      const msg = this.db.getMessage(id);
      if (msg) {
        this.db.updateMessageStatus(id, 'acked');
        acked++;
      }
    }

    return Response.json({ success: true, acked });
  }
}
```

- [ ] **Step 2: 提交**

```bash
git add src/server/http/im-routes.ts
git commit -m "feat: create IMRoutes for message endpoints"
```

---

## Task 6: 创建 BountyWebSocketServer

**Files:**
- Create: `src/server/ws/index.ts`
- Modify: `src/im/server/ws.ts` (保留向后兼容)

- [ ] **Step 1: 创建 src/server/ws/index.ts**

```typescript
/**
 * Bounty WebSocket Server
 * 
 * Provides WebSocket endpoint for real-time messaging:
 * - ws://host:port/ws?address=agent@host
 */

import type { IMDatabase } from '../../im/db';
import type { Message } from '../../im/types';

interface ClientInfo {
  socket: any;
  address: string;
}

export class BountyWebSocketServer {
  private clients: Map<string, ClientInfo> = new Map();
  private port: number;
  private db: IMDatabase;
  private server: any = null;

  constructor(db: IMDatabase, port: number = 4003) {
    this.db = db;
    this.port = port;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req, server) => {
        const url = new URL(req.url);
        if (url.pathname === '/ws') {
          const address = url.searchParams.get('address');
          
          if (!address) {
            return new Response(JSON.stringify({
              event: 'error',
              data: { message: 'Missing required parameter: address' }
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const success = server.upgrade(req, {
            data: { address },
          } as any);

          if (success) {
            return;
          }
        }
        
        return new Response('Bounty WebSocket Server', { status: 200 });
      },
      websocket: {
        open: (socket) => this.handleOpen(socket),
        message: (socket, message) => this.handleMessage(socket, message),
        close: (socket) => this.handleClose(socket),
      },
    });

    this.port = this.server.port;
  }

  stop(): void {
    if (this.server) {
      for (const [address, client] of this.clients) {
        client.socket.close();
        this.updateAgentStatus(address, 'offline');
      }
      this.clients.clear();
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.port;
  }

  pushMessage(address: string, message: Message): void {
    const client = this.clients.get(address);
    if (client) {
      try {
        client.socket.send(JSON.stringify({
          event: 'message',
          data: message,
        }));
      } catch (err) {
        console.error(`[WS] Error sending message:`, err);
      }
    }
  }

  private handleOpen(socket: any): void {
    const address = socket.data?.address;

    if (!address) {
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: 'Missing required parameter: address' },
      }));
      socket.close();
      return;
    }

    this.clients.set(address, { socket, address });
    this.updateAgentStatus(address, 'online');

    socket.send(JSON.stringify({
      event: 'connected',
      data: { address },
    }));

    // Send pending messages
    const pendingMessages = this.db.getPendingMessages(address);
    for (const msg of pendingMessages) {
      socket.send(JSON.stringify({
        event: 'message',
        data: msg,
      }));
      if (msg.status === 'pending') {
        this.db.updateMessageStatus(msg.id, 'delivered');
      }
    }
  }

  private handleMessage(socket: any, message: any): void {
    const address = socket.data?.address;
    
    if (!address) {
      return;
    }

    try {
      const msg = typeof message === 'string' ? JSON.parse(message) : message;
      
      switch (msg.event) {
        case 'ping':
          socket.send(JSON.stringify({ event: 'pong' }));
          break;

        case 'ack':
          if (msg.data && Array.isArray(msg.data.messageIds)) {
            for (const id of msg.data.messageIds) {
              this.db.updateMessageStatus(id, 'acked');
            }
          }
          break;

        case 'message':
          if (msg.data && msg.data.to) {
            const imMessage: Message = {
              id: crypto.randomUUID(),
              from: address,
              to: msg.data.to,
              content: msg.data.content || { type: 'text', body: '' },
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            
            this.db.saveMessage(imMessage);
            
            const recipient = this.clients.get(msg.data.to);
            if (recipient) {
              recipient.socket.send(JSON.stringify({
                event: 'message',
                data: imMessage,
              }));
              this.db.updateMessageStatus(imMessage.id, 'delivered');
            }
          }
          break;

        default:
          socket.send(JSON.stringify({
            event: 'error',
            data: { message: `Unknown event: ${msg.event}` },
          }));
      }
    } catch (err) {
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: 'Invalid JSON message' },
      }));
    }
  }

  private handleClose(socket: any): void {
    const address = socket.data?.address;
    
    if (address) {
      this.clients.delete(address);
      this.updateAgentStatus(address, 'offline');
    }
  }

  private updateAgentStatus(address: string, status: 'online' | 'offline'): void {
    const [agentId, host] = address.split('@');
    
    if (!agentId || !host) {
      return;
    }

    let agent = this.db.getAgentByAddress(address);

    if (!agent) {
      const now = new Date().toISOString();
      agent = {
        id: agentId,
        host,
        address,
        status,
        lastSeenAt: now,
        createdAt: now,
      };
      this.db.saveAgent(agent);
    } else {
      this.db.updateAgentStatus(agent.id, status);
    }
  }
}
```

- [ ] **Step 2: 更新 src/im/server/ws.ts 保留向后兼容**

在原文件开头添加：

```typescript
/**
 * @deprecated Use 'server/ws/index.ts' instead
 */
export { BountyWebSocketServer } from '../../server/ws/index.js';
import { BountyWebSocketServer as NewServer } from '../../server/ws/index.js';
export const IMWebSocketServer = NewServer;
```

- [ ] **Step 3: 提交**

```bash
git add src/server/ws/index.ts src/im/server/ws.ts
git commit -m "feat: create BountyWebSocketServer"
```

---

## Task 7: 更新 start-server.ts 使用环境变量

**Files:**
- Create: `start-server.ts` (覆盖)

- [ ] **Step 1: 更新 start-server.ts**

```typescript
/**
 * Bounty Server Entry Point
 * 
 * Starts the full Bounty platform server with:
 * - HTTP API (Auth + Bounty + IM)
 * - WebSocket for real-time messaging
 * 
 * Environment Variables:
 * - BOUNTY_PORT: HTTP server port (default: 4002)
 * - BOUNTY_WS_PORT: WebSocket port (default: BOUNTY_PORT + 1)
 * - BOUNTY_DB_PATH: Bounty database path (default: ./data/bounty.db)
 * - BOUNTY_IM_DB_PATH: IM database path (default: ./data/im.db)
 */

import { config } from 'dotenv';
config();

import { Database } from './src/lib/storage/database';
import { IMDatabase } from './src/im/db';
import { BountyHTTPServer } from './src/server/http';
import { BountyWebSocketServer } from './src/server/ws';

// Load configuration from environment
const HTTP_PORT = parseInt(process.env.BOUNTY_PORT || '4002');
const WS_PORT = process.env.BOUNTY_WS_PORT
  ? parseInt(process.env.BOUNTY_WS_PORT)
  : HTTP_PORT + 1;

const BOUNTY_DB_PATH = process.env.BOUNTY_DB_PATH || './data/bounty.db';
const BOUNTY_IM_DB_PATH = process.env.BOUNTY_IM_DB_PATH || './data/im.db';

async function main() {
  console.log('🚀 启动 Bounty Server...');
  console.log(`   HTTP API:  http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket: ws://localhost:${WS_PORT}/ws`);

  // Initialize databases
  const bountyDb = new Database({ path: BOUNTY_DB_PATH });
  const imDb = new IMDatabase({ path: BOUNTY_IM_DB_PATH });

  console.log(`✅ 数据库初始化完成`);
  console.log(`   Bounty DB: ${BOUNTY_DB_PATH}`);
  console.log(`   IM DB: ${BOUNTY_IM_DB_PATH}`);

  // Create and start HTTP server
  const httpServer = new BountyHTTPServer({
    imDb,
    bountyDb,
    port: HTTP_PORT,
  });

  // Create WebSocket server
  const wsServer = new BountyWebSocketServer(imDb, WS_PORT);

  // Register push callback for HTTP → WebSocket message push
  httpServer.setPushCallback((address, message) => {
    wsServer.pushMessage(address, message);
  });

  // Start servers
  await httpServer.start();
  await wsServer.start();

  console.log(`\n✅ Bounty Server 启动完成！`);
  console.log(`   HTTP API:  http://localhost:${httpServer.getPort()}`);
  console.log(`   WebSocket: ws://localhost:${wsServer.getPort()}/ws`);
  console.log(`\n   按 Ctrl+C 停止服务器\n`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 正在停止服务器...');
    wsServer.stop();
    httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
```

- [ ] **Step 2: 提交**

```bash
git add start-server.ts
git commit -m "feat: update start-server with env config for ports"
```

---

## Task 8: 更新 .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: 更新 .env.example**

找到并更新 Server Configuration 部分：

```bash
# Server Configuration
BOUNTY_PORT=4002              # HTTP 端口（默认 4002）
BOUNTY_WS_PORT=4003           # WebSocket 端口（默认 PORT+1）
BOUNTY_DB_PATH=./data/bounty.db
BOUNTY_IM_DB_PATH=./data/im.db

# Domain
BOUNTY_DOMAIN=bounty.example.com

# JWT Secret (generate a secure random string for production)
JWT_SECRET=change-this-to-a-secure-random-string-in-production
```

- [ ] **Step 2: 提交**

```bash
git add .env.example
git commit -m "docs: update .env.example with port configuration"
```

---

## Task 9: 更新 scripts/start-im-server.ts

**Files:**
- Modify: `scripts/start-im-server.ts`

- [ ] **Step 1: 更新 scripts/start-im-server.ts**

```typescript
/**
 * Bounty IM Server 启动脚本
 * 
 * 使用方式: bun run scripts/start-im-server.ts
 * 
 * Environment Variables:
 * - BOUNTY_PORT: HTTP 端口（默认 4002）
 * - BOUNTY_WS_PORT: WebSocket 端口（默认 PORT+1）
 * - BOUNTY_IM_DB_PATH: IM 数据库路径（默认 ./data/im.db）
 */

import { config } from 'dotenv';
config();

import { IMDatabase } from '../src/im/db/index.js';
import { BountyWebSocketServer } from '../src/server/ws/index.js';
import { BountyHTTPServer } from '../src/server/http/index.js';

async function main() {
  const HTTP_PORT = parseInt(process.env.BOUNTY_PORT || '4002');
  const WS_PORT = process.env.BOUNTY_WS_PORT
    ? parseInt(process.env.BOUNTY_WS_PORT)
    : HTTP_PORT + 1;
  const IM_DB_PATH = process.env.BOUNTY_IM_DB_PATH || './data/im.db';

  console.log(`🚀 启动 Bounty IM Server...`);
  console.log(`   HTTP: http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket: ws://localhost:${WS_PORT}/ws`);

  // 初始化 IM 数据库
  const imDb = new IMDatabase({ path: IM_DB_PATH });
  console.log(`✅ IM 数据库初始化完成: ${IM_DB_PATH}`);

  // 启动 WebSocket 服务器
  const wsServer = new BountyWebSocketServer(imDb, WS_PORT);
  await wsServer.start();
  console.log(`✅ WebSocket 服务器已启动: ws://localhost:${wsServer.getPort()}/ws`);

  // 启动 HTTP 服务器（不启用 Bounty 功能，仅 IM）
  const httpServer = new BountyHTTPServer({ imDb, port: HTTP_PORT });
  await httpServer.start();
  console.log(`✅ HTTP 服务器已启动: http://localhost:${httpServer.getPort()}`);

  console.log(`\n📍 IM Server 启动完成！`);
  console.log(`   按 Ctrl+C 停止服务器\n`);

  // 处理关闭信号
  const shutdown = async () => {
    console.log('\n🛑 正在停止服务器...');
    wsServer.stop();
    httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
```

- [ ] **Step 2: 提交**

```bash
git add scripts/start-im-server.ts
git commit -m "feat: update start-im-server with env config"
```

---

## Task 10: 运行测试验证

- [ ] **Step 1: 运行所有测试**

```bash
bun test
```

预期: 所有测试通过（包括 4 个之前失败的 Auth 测试）

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "test: verify all tests pass after refactor"
```

---

## Task 11: 更新文档

**Files:**
- Modify: `docs/superpowers/specs/2026-05-18-bounty-server-architecture-refactor.md`

- [ ] **Step 1: 更新文档状态为已完成**

将 `状态: Draft` 改为 `状态: Completed`，添加实施日期

- [ ] **Step 2: 提交**

```bash
git add docs/
git commit -m "docs: mark architecture refactor as completed"
```

---

## 影响范围检查

| 文件 | 操作 |
|------|------|
| `src/server/` | Create |
| `src/server/index.ts` | Create |
| `src/server/http/index.ts` | Create |
| `src/server/http/auth-routes.ts` | Create |
| `src/server/http/bounty-routes.ts` | Create |
| `src/server/http/im-routes.ts` | Create |
| `src/server/ws/index.ts` | Create |
| `src/index.ts` | Modify (exports) |
| `src/im/server/http.ts` | Modify (backward compat) |
| `src/im/server/ws.ts` | Modify (backward compat) |
| `start-server.ts` | Modify |
| `scripts/start-im-server.ts` | Modify |
| `.env.example` | Modify |

---

## Plan Complete

实现计划已完成并保存到 `docs/superpowers/plans/2026-05-18-bounty-server-architecture-refactor.md`

**两个执行选项：**

1. **Subagent-Driven (推荐)** - 每个 Task 由 fresh subagent 执行，期间进行 review，快速迭代

2. **Inline Execution** - 在此 session 中执行任务，使用 executing-plans，批量执行带 checkpoint

选择哪个方式？