import type { IMDatabase } from '../db';
import type { Message, Content } from '../types';
import { createAuthRoutes } from '../../auth/routes';
import type { Database } from '../../lib/storage/database';

type PushCallback = (address: string, message: Message) => void;

export class IMHTTPServer {
  private db: IMDatabase;
  private bountyDb: Database | null = null;
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private pushCallback: PushCallback | null = null;

  constructor(db: IMDatabase, port = 3001, bountyDb?: Database) {
    this.db = db;
    this.port = port;
    this.bountyDb = bountyDb || null;
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

  /**
   * Set the bounty database (for auth integration)
   */
  setBountyDb(db: Database): void {
    this.bountyDb = db;
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // Auth routes - public (no middleware)
      if (this.bountyDb) {
        const auth = createAuthRoutes(this.bountyDb);

        // POST /api/auth/register
        if (method === 'POST' && path === '/api/auth/register') {
          return await auth.registerRoute(req);
        }

        // POST /api/auth/verify
        if (method === 'POST' && path === '/api/auth/verify') {
          return await auth.verifyRoute(req);
        }

        // POST /api/auth/login
        if (method === 'POST' && path === '/api/auth/login') {
          return await auth.loginRoute(req);
        }

        // POST /api/auth/send-code
        if (method === 'POST' && path === '/api/auth/send-code') {
          return await auth.sendCodeRoute(req);
        }

        // Protected routes - require auth
        const authResult = await this.checkAuth(req);
        if (authResult.error) {
          return authResult.error;
        }

        // GET /api/agents/me - protected
        if (method === 'GET' && path === '/api/agents/me') {
          return this.handleGetCurrentAgent(req, authResult.agentId!);
        }

        // GET /api/agents/me/credits - protected
        if (method === 'GET' && path === '/api/agents/me/credits') {
          return this.handleGetCurrentAgentCredits(req, authResult.agentId!);
        }

        // Protected /api/messages routes
        if (method === 'GET' && path === '/api/messages') {
          return this.handleGetMessages(url);
        }

        if (method === 'POST' && path === '/api/messages') {
          return await this.handleSendMessage(req);
        }

        if (method === 'GET' && path.startsWith('/api/messages/')) {
          const id = path.slice('/api/messages/'.length);
          return this.handleGetMessageById(id);
        }

        if (method === 'POST' && path === '/api/messages/ack') {
          return await this.handleAckMessages(req);
        }

        // Protected /api/tasks routes
        if (method === 'GET' && path === '/api/tasks') {
          return this.handleGetTasks(authResult.agentId!);
        }

        if (method === 'POST' && path === '/api/tasks') {
          return await this.handleCreateTask(req, authResult.agentId!);
        }

        if (method === 'GET' && path.startsWith('/api/tasks/') && path.endsWith('/grab')) {
          const id = path.slice('/api/tasks/'.length, -'/grab'.length);
          return this.handleGrabTask(id, authResult.agentId!);
        }

        if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/submit')) {
          const id = path.slice('/api/tasks/'.length, -'/submit'.length);
          return await this.handleSubmitTask(req, id, authResult.agentId!);
        }
      }

      // Legacy public routes (for backward compatibility)
      // GET /health
      if (method === 'GET' && path === '/health') {
        return Response.json({
          status: 'ok',
          timestamp: Date.now(),
        });
      }

      // POST /messages
      if (method === 'POST' && path === '/messages') {
        return this.handleSendMessage(req);
      }

      // POST /messages/ack
      if (method === 'POST' && path === '/messages/ack') {
        return this.handleAckMessages(req);
      }

      // GET /messages or GET /messages?address=xxx
      if (method === 'GET' && path === '/messages') {
        return this.handleGetMessages(url);
      }

      // GET /messages/:id
      if (method === 'GET' && path.startsWith('/messages/')) {
        const id = path.slice('/messages/'.length);
        return this.handleGetMessageById(id);
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      console.error('Request error:', err);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  /**
   * Check authentication and return agent ID if valid
   */
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

  /**
   * Handle GET /api/agents/me - get current authenticated agent
   */
  private handleGetCurrentAgent(_req: Request, agentId: string): Response {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

    const agent = this.bountyDb.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }
    return Response.json(agent);
  }

  /**
   * Handle GET /api/agents/me/credits - get current agent's credits
   */
  private handleGetCurrentAgentCredits(_req: Request, agentId: string): Response {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

    const agent = this.bountyDb.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const transactions = this.bountyDb.prepare(`
      SELECT * FROM credit_transactions 
      WHERE agent_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(agentId);

    return Response.json({
      credits: (agent as any).credits,
      transactions
    });
  }

  /**
   * Handle GET /api/tasks - get tasks (protected)
   */
  private handleGetTasks(_agentId: string): Response {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

    const tasks = this.bountyDb.prepare(`
      SELECT * FROM tasks ORDER BY created_at DESC
    `).all();

    return Response.json(tasks);
  }

  /**
   * Handle POST /api/tasks - create a new task (protected)
   */
  private async handleCreateTask(req: Request, agentId: string): Promise<Response> {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

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

    // Get agent email
    const agent = this.bountyDb.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Date.now();
    const taskId = crypto.randomUUID();

    this.bountyDb.prepare(`
      INSERT INTO tasks (id, title, description, type, reward, publisher_id, publisher_email, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)
    `).run(taskId, title, description, type || 'bounty', reward, agentId, agent.email, now, now);

    const task = this.bountyDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(task, { status: 201 });
  }

  /**
   * Handle PUT /api/tasks/:id/grab - grab a task (protected)
   */
  private handleGrabTask(taskId: string, agentId: string): Response {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

    const task = this.bountyDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.status !== 'open') {
      return Response.json({ error: 'Task is not open' }, { status: 400 });
    }

    // Get agent email
    const agent = this.bountyDb.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const now = Date.now();
    this.bountyDb.prepare(`
      UPDATE tasks SET assignee_id = ?, assignee_email = ?, status = 'in_progress', updated_at = ?
      WHERE id = ?
    `).run(agentId, agent.email, now, taskId);

    const updatedTask = this.bountyDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(updatedTask);
  }

  /**
   * Handle PUT /api/tasks/:id/submit - submit task result (protected)
   */
  private async handleSubmitTask(req: Request, taskId: string, agentId: string): Promise<Response> {
    if (!this.bountyDb) {
      return Response.json({ error: 'Bounty database not configured' }, { status: 500 });
    }

    let body: { result?: string };
    try {
      const text = await req.text();
      body = JSON.parse(text || '{}');
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const task = this.bountyDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId) as any;
    if (!task) {
      return Response.json({ error: 'Task not found' }, { status: 404 });
    }

    if (task.assignee_id !== agentId) {
      return Response.json({ error: 'Not authorized to submit this task' }, { status: 403 });
    }

    const now = Date.now();
    this.bountyDb.prepare(`
      UPDATE tasks SET result = ?, status = 'submitted', updated_at = ?
      WHERE id = ?
    `).run(body.result || '', now, taskId);

    const updatedTask = this.bountyDb.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    return Response.json(updatedTask);
  }

  private async handleSendMessage(req: Request): Promise<Response> {
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

  private handleGetMessages(url: URL): Response {
    const address = url.searchParams.get('address');

    if (!address) {
      return Response.json([]);
    }

    const messages = this.db.getInbox(address);
    return Response.json(messages);
  }

  private handleGetMessageById(id: string): Response {
    const message = this.db.getMessage(id);

    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }

    return Response.json(message);
  }

  private async handleAckMessages(req: Request): Promise<Response> {
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
