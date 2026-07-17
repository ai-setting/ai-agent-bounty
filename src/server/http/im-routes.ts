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

/**
 * v0.13.2: Callback shape for resolving a user-supplied identifier
 * (email or `<uuid>@<host>`) to the canonical IM address.
 *
 * Used by `IMRoutes.getMessages` so the protected inbox handler can accept
 * `?email=<email>` without doing its own DB lookup. The server wires this
 * up to `findAgentByEmailOrAddress(db, …)` at construction time.
 *
 * Return value:
 *   - `<uuid>@<host>` on hit
 *   - `null` on miss / invalid input
 */
export type ResolveIdentifierFn = (input: string) => string | null;

export class IMRoutes {
  private db: IMDatabase;
  private pushCallback: ((address: string, message: Message) => boolean) | null;
  /**
   * v0.13.2: optional identifier resolver. When set, `getMessages` will use
   * it to map `?email=<email>` (or any non-canonical input) to the
   * canonical `<uuid>@<host>` address before performing the ownership
   * check and IM DB lookup. The server wires this to
   * `findAgentByEmailOrAddress(bountyDb, …)` so the IM routes don't need
   * a direct reference to the bounty DB.
   */
  private resolveIdentifier: ResolveIdentifierFn | null;

  constructor(
    db: IMDatabase,
    pushCallback?: (address: string, message: Message) => boolean,
    resolveIdentifier?: ResolveIdentifierFn
  ) {
    this.db = db;
    this.pushCallback = pushCallback || null;
    this.resolveIdentifier = resolveIdentifier || null;
  }

  setPushCallback(callback: (address: string, message: Message) => boolean): void {
    this.pushCallback = callback;
  }

  /**
   * v0.13.2: install or replace the identifier resolver at runtime.
   * Useful for tests and for late DI wiring from the bounty server.
   */
  setResolveIdentifier(fn: ResolveIdentifierFn | null): void {
    this.resolveIdentifier = fn;
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
    const rawIdentifier =
      normalizeAgentIdentifier(url.searchParams.get('email')) ??
      normalizeAgentIdentifier(url.searchParams.get('address'));
    if (!rawIdentifier) {
      return Response.json(
        { error: 'Missing required query parameter: email or address' },
        { status: 400 }
      );
    }

    // v0.13.2: resolve the identifier to the canonical `<uuid>@<host>` form.
    // - If the input already matches `<uuid>@<host>` we keep it as-is.
    // - Otherwise we ask the resolver (wired by the server to
    //   `findAgentByEmailOrAddress`) to map email → address.
    // - On miss we return 404 so callers know the identifier is unknown.
    const address = this.resolveCanonicalAddress(rawIdentifier);
    if (!address) {
      return Response.json(
        { error: `Unknown agent identifier: ${rawIdentifier}` },
        { status: 404 }
      );
    }

    // Ownership: caller JWT.sub must match the UUID part of the resolved
    // canonical address. With the resolver in place, `address` is always
    // `<uuid>@<host>` so the comparison is well-defined.
    if (!this.requesterOwnsAddress(requester.agentId, address)) {
      return Response.json(
        { error: "Forbidden: cannot read another agent's inbox" },
        { status: 403 }
      );
    }

    const messages = this.db.getInbox(address);
    return Response.json(messages);
  }

  /**
   * v0.13.2: Resolve a user-supplied identifier to the canonical
   * `<uuid>@<host>` IM address.
   *
   * - Inputs that already look like `<uuid>@<host>` are returned as-is
   *   (no resolver round-trip needed — preserves the legacy fast path).
   * - Other inputs (e.g. emails) are dispatched through the configured
   *   resolver, which is wired by the server to
   *   `findAgentByEmailOrAddress(bountyDb, …)`.
   * - Returns `null` when the resolver is missing or returns null. Callers
   *   should treat this as an unknown identifier and return 404.
   */
  private resolveCanonicalAddress(input: string): string | null {
    const UUID_HOST = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/i;
    if (UUID_HOST.test(input)) {
      return input;
    }
    if (!this.resolveIdentifier) {
      // No resolver wired: we cannot map email → address. Treat as unknown
      // so the handler returns 404 instead of mis-attributing ownership.
      return null;
    }
    return this.resolveIdentifier(input);
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
   * v0.13.2: `getMessages` now resolves `?email=` to a canonical
   * `<uuid>@<host>` BEFORE calling this helper, so we always compare
   * the UUID-prefixed address against `requester.agentId`. The old
   * `requesterOwnsIdentifier` helper (which tolerated email-shaped input
   * by conservatively returning false) is no longer used and has been
   * removed.
   */
  private requesterOwnsAddress(agentId: string, address: string): boolean {
    const [local] = address.split('@');
    return local === agentId;
  }
}
