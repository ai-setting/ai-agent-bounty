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
