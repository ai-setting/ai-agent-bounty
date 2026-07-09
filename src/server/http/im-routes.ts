/**
 * IM Routes
 *
 * Handles IM message endpoints:
 * - GET  /api/messages?address=<addr> (protected, address must match requester)
 * - POST /api/messages                 (send, public — same as before)
 * - GET  /api/messages/:id             (protected, requester must be a participant)
 * - POST /api/messages/ack             (acknowledge)
 *
 * Authorization model:
 *   - getMessages and getMessageById require a Bearer token (verified by the
 *     HTTP server's checkAuth). The handler then enforces that the caller
 *     owns the address being read (inbox) or is a participant of the message.
 */

import type { IMDatabase } from '../../im/db';
import type { Message, Content } from '../../im/types';

interface RequesterInfo {
  agentId: string;
}

export class IMRoutes {
  private db: IMDatabase;
  private pushCallback: ((address: string, message: Message) => boolean) | null;

  constructor(db: IMDatabase, pushCallback?: (address: string, message: Message) => boolean) {
    this.db = db;
    this.pushCallback = pushCallback || null;
  }

  setPushCallback(callback: (address: string, message: Message) => boolean): void {
    this.pushCallback = callback;
  }

  async sendMessage(req: Request, requester?: RequesterInfo): Promise<Response> {
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

    // Phase 4 (token check toggle): from 来源策略
    // - 检查 requester.agentId (有值) → 该 agent 的 agent_id 是 authoritative sender
    //   (用 `@authenticated` suffix 让 server 端能 push 到正确的 ws client)
    // - requester 缺失 OR agentId undefined → legacy 行为: 用 body.from (caller 自报)
    //
    // 注意: token check OFF 场景下 requester=undefined, 走 legacy path;
    //      token check ON 场景下 requester.agentId 是真值, 强制覆盖 body.from (防止冒充)
    const requesterAgentId = requester?.agentId as string | undefined;
    const from =
      requesterAgentId
        ? `${requesterAgentId}@authenticated`
        : body.from || 'anonymous@server.com';

    const message: Message = {
      id: crypto.randomUUID(),
      from,
      to,
      content,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    this.db.saveMessage(message);

    if (this.pushCallback) {
      const pushed = this.pushCallback(to, message);
      if (pushed) {
        this.db.updateMessageStatus(message.id, 'delivered');
      }
    }

    return Response.json(message, { status: 201 });
  }

  getMessages(url: URL, requester: RequesterInfo): Response {
    const address = url.searchParams.get('address');
    if (!address) {
      return Response.json({ error: 'Missing required query parameter: address' }, { status: 400 });
    }
    if (!this.requesterOwnsAddress(requester.agentId, address)) {
      return Response.json(
        { error: 'Forbidden: cannot read another agent\'s inbox' },
        { status: 403 }
      );
    }
    const messages = this.db.getInbox(address);
    return Response.json(messages);
  }

  /**
   * Legacy unauthenticated inbox lookup. Returns the messages for the
   * `address` query parameter without checking the caller's identity.
   * New clients should use the protected `getMessages` instead.
   */
  getMessagesForAddress(url: URL): Response {
    const address = url.searchParams.get('address');
    if (!address) {
      return Response.json([]);
    }
    return Response.json(this.db.getInbox(address));
  }

  getMessageById(id: string, requester: RequesterInfo): Response {
    const message = this.db.getMessage(id);
    if (!message) {
      return Response.json({ error: 'Message not found' }, { status: 404 });
    }
    if (
      !this.requesterOwnsAddress(requester.agentId, message.to) &&
      !this.requesterOwnsAddress(requester.agentId, message.from)
    ) {
      return Response.json(
        { error: 'Forbidden: not a participant of this message' },
        { status: 403 }
      );
    }
    return Response.json(message);
  }

  /**
   * Legacy unauthenticated single-message lookup. Network-layer ACL is
   * the responsibility of the operator; new clients should use
   * `getMessageById` so that the caller's identity is verified.
   */
  getMessageByIdPublic(id: string): Response {
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

  /**
   * An agent "owns" an address when the local part of the address
   * matches its agent id. The host is intentionally ignored so that the
   * same agent can read messages addressed to any deployment-specific
   * domain (`bounty.local`, `secure.com`, etc.).
   */
  private requesterOwnsAddress(agentId: string, address: string): boolean {
    const [local] = address.split('@');
    return local === agentId;
  }
}
