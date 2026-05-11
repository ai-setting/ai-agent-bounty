import type { IMDatabase } from '../db';
import type { Message, Content } from '../types';

type PushCallback = (address: string, message: Message) => void;

export class IMHTTPServer {
  private db: IMDatabase;
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private pushCallback: PushCallback | null = null;

  constructor(db: IMDatabase, port = 3001) {
    this.db = db;
    this.port = port;
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
