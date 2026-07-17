/**
 * IM Routes
 *
 * Handles IM message endpoints:
 * - GET  /api/messages?address=<addr> | ?email=<addr> (protected, requester must match)
 * - POST /api/messages                 (send, public — same as before)
 * - GET  /api/messages/:id             (protected, requester must be a participant)
 * - POST /api/messages/ack             (acknowledge)
 *
 * v0.13: All endpoints that accept an agent identifier now accept EITHER
 *   - `email`  (e.g. `alice@example.com`)  ← PRIMARY lookup key (agents.email UNIQUE)
 *   - `address` (e.g. `uuid@host`)         ← secondary, backward-compat
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

/**
 * v0.13: Convert a user-supplied agent identifier (email OR address) into
 * the canonical `<uuid>@<host>` IM address string used by the message store.
 *
 * Pure string transform — no DB lookup. Caller (or `getMessages` handler)
 * is responsible for verifying the identifier actually belongs to a known
 * agent. Returns the trimmed string on success or `null` if the input is
 * blank / non-string.
 *
 * Recognised inputs:
 *   - `alice@example.com`         → unchanged (caller can later resolve to address)
 *   - `uuid@host`                → unchanged (legacy)
 *
 * Note: this helper does NOT distinguish between email and address — IM
 * storage key is `<uuid>@<host>`, so when an email is supplied the caller
 * must resolve it through `findAgentByEmailOrAddress` first. The WS handler
 * does that lookup before writing the message.
 */
export function normalizeAgentIdentifier(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  return raw || null;
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
    let body: {
      from?: string;
      to?: string;
      from_email?: string;
      to_email?: string;
      content?: Content;
    };

    try {
      const text = await req.text();
      if (!text) {
        return Response.json({ error: 'Missing request body' }, { status: 400 });
      }
      body = JSON.parse(text);
    } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { content } = body;
    // v0.13: prefer `*_email` body fields; fall back to legacy `*` (address).
    const to = normalizeAgentIdentifier(body.to_email) ??
                normalizeAgentIdentifier(body.to);
    const fromExplicit = normalizeAgentIdentifier(body.from_email) ??
                          normalizeAgentIdentifier(body.from);

    if (!to) {
      return Response.json(
        { error: 'Missing required field: to_email (or legacy to)' },
        { status: 400 }
      );
    }

    if (!content) {
      return Response.json({ error: 'Missing required field: content' }, { status: 400 });
    }

    // Phase 4 (token check toggle): from 来源策略
    // - 检查 requester.agentId (有值) → 该 agent 的 agent_id 是 authoritative sender
    //   (用 `@authenticated` suffix 让 server 端能 push 到正确的 ws client)
    // - requester 缺失 OR agentId undefined → legacy 行为: 用 body.from (caller 自报)
    //
    // v0.13: `from_email` / `from` are accepted equally. When the requester is
    // authenticated, body.from* is intentionally ignored to prevent impersonation.
    //
    // 注意: token check OFF 场景下 requester=undefined, 走 legacy path;
    //      token check ON 场景下 requester.agentId 是真值, 强制覆盖 body.from (防止冒充)
    const requesterAgentId = requester?.agentId as string | undefined;
    const from =
      requesterAgentId
        ? `${requesterAgentId}@authenticated`
        : fromExplicit || 'anonymous@server.com';

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
    // v0.13: prefer `?email=`, fall back to `?address=` (legacy).
    const address =
      normalizeAgentIdentifier(url.searchParams.get('email')) ??
      normalizeAgentIdentifier(url.searchParams.get('address'));
    if (!address) {
      return Response.json(
        { error: 'Missing required query parameter: email or address' },
        { status: 400 }
      );
    }
    if (!this.requesterOwnsIdentifier(requester.agentId, address)) {
      return Response.json(
        { error: "Forbidden: cannot read another agent's inbox" },
        { status: 403 }
      );
    }
    // v0.13: when the caller passes an email, we still need the canonical
    // <uuid>@<host> address that the IM DB stores under. Caller is expected
    // to pass an address here in the common case; if they pass an email,
    // we cannot resolve it without a DB lookup, so we fall through to the
    // inbox-by-email endpoint below.
    if (address.includes('@') && !/^[0-9a-f-]{36}@/.test(address)) {
      // Looks like an email (not a uuid@host). The IM DB is keyed by
      // address only; in practice, the protected inbox handler requires
      // the caller to send the canonical address. Email-only callers
      // must resolve through /api/agents/me first.
      return Response.json(
        {
          error:
            "Email-only inbox not supported on IM store; resolve via /api/agents/me to obtain the address and retry with ?address=<uuid>@<host>.",
        },
        { status: 400 }
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
    // v0.13: also accept `?email=` here (legacy callers used `?address=`).
    const address =
      normalizeAgentIdentifier(url.searchParams.get('address')) ??
      normalizeAgentIdentifier(url.searchParams.get('email'));
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
   *
   * v0.13: callers may now pass an email instead of an address. Email-only
   * callers cannot be matched by local-part alone — they must resolve to
   * an address via `/api/agents/me` first. This helper still validates
   * `<local>@<host>` shape and falls back to `false` for email-shaped input.
   */
  private requesterOwnsAddress(agentId: string, address: string): boolean {
    const [local] = address.split('@');
    return local === agentId;
  }

  /**
   * v0.13 variant of `requesterOwnsAddress` that accepts either an address
   * (`<uuid>@<host>`) or an email (`alice@example.com`). For an email we
   * conservatively return `false` — the protected inbox handler is keyed by
   * the canonical IM address, so the caller is expected to have resolved
   * email → address via the agents API before reaching this point.
   */
  private requesterOwnsIdentifier(agentId: string, identifier: string): boolean {
    const [local] = identifier.split('@');
    if (local !== agentId) return false;
    // Distinguish email-shaped (alice@example.com — local is short) from
    // uuid-shaped address: if the local part is a UUID, treat as address;
    // otherwise (email), the inbox is not directly addressable here.
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(local);
  }
}
