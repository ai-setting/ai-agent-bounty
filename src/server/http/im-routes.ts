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

/**
 * v0.14.1: Callback shape for resolving a user-supplied identifier
 * (email or `<uuid>@<host>`) to the **registered email** of the agent.
 *
 * Used by `IMRoutes.sendMessage` / `getMessages` to surface `from_email` /
 * `to_email` in HTTP responses. The server wires this to
 * `findAgentByEmailOrAddress(db, …)?.email` at construction time.
 *
 * Return value:
 *   - registered email on hit (e.g. `alice@example.com`)
 *   - the raw input string when no mapping is found (so the response is
 *     still useful — CLI sees the original email even when the agent is
 *     unknown / unregistered)
 *   - `null` only when the input is blank
 */
export type ResolveEmailFn = (input: string) => string | null;

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
  /**
   * v0.14.1: optional email resolver. When set, `sendMessage` / `getMessages`
   * will surface the registered email alongside the canonical `from` / `to`.
   * The server wires this to `findAgentByEmailOrAddress(db, …)?.email`.
   */
  private resolveEmail: ResolveEmailFn | null;

  constructor(
    db: IMDatabase,
    pushCallback?: (address: string, message: Message) => boolean,
    resolveIdentifier?: ResolveIdentifierFn,
    resolveEmail?: ResolveEmailFn
  ) {
    this.db = db;
    this.pushCallback = pushCallback || null;
    this.resolveIdentifier = resolveIdentifier || null;
    this.resolveEmail = resolveEmail || null;
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

  /**
   * v0.14.1: install or replace the email resolver at runtime.
   * Useful for tests and for late DI wiring from the bounty server.
   */
  setResolveEmail(fn: ResolveEmailFn | null): void {
    this.resolveEmail = fn;
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
    const toRaw = normalizeAgentIdentifier(body.to_email) ??
                  normalizeAgentIdentifier(body.to);
    const fromExplicit = normalizeAgentIdentifier(body.from_email) ??
                          normalizeAgentIdentifier(body.from);

    if (!toRaw) {
      return Response.json(
        { error: 'Missing required field: to_email (or legacy to)' },
        { status: 400 }
      );
    }

    if (!content) {
      return Response.json({ error: 'Missing required field: content' }, { status: 400 });
    }

    // v0.13.4: Normalize the recipient to the canonical `<uuid>@<host>` form
    // before persisting. The protected inbox handler (v0.13.2) already maps
    // `?email=<email>` to canonical before the IM DB lookup, so leaving the
    // raw email in `messages.to_address` caused the just-sent message to be
    // invisible to the sender's own inbox query.
    //
    // We fall back to the raw input when the resolver is not wired or cannot
    // map the input to a known agent. This preserves the pre-v0.13 behavior
    // of accepting arbitrary recipient strings (e.g. external systems,
    // unregistered identifiers) so we don't silently drop messages.
    const to = this.resolveCanonicalAddress(toRaw) ?? toRaw;

    // v0.14.2: Reject self-message at HTTP level. Compares the UUID part of
    // the resolved recipient `to` against the authenticated sender's UUID
    // (from `requester.agentId`). When the caller's JWT identifies them as
    // `requesterAgentId`, the server's `from` field is forced to
    // `${requesterAgentId}@authenticated`. If `to`'s UUID matches, it's a
    // self-send — return HTTP 400 SELF_MESSAGE_NOT_ALLOWED.
    //
    // For non-authenticated callers (token check OFF, requester undefined),
    // we still compute a `from` UUID so we can defend even when the CLI
    // passes `from_email=<self-email>` in the body. The raw input's UUID
    // extraction is best-effort; if it doesn't look like a UUID-prefixed
    // address, the check passes through and we let the legacy path handle it.
    //
    // Why HTTP 400, not 4xx-with-warning: Plan C explicitly chose to reject
    // self-message at the API surface to avoid the phantom echo in client
    // inbox. The CLI now surfaces a clear error rather than silently dropping
    // the message.
    const requesterAgentIdForCheck = requester?.agentId as string | undefined;
    const fromUuid =
      requesterAgentIdForCheck ??
      // For unauthenticated callers, best-effort fallback: use the UUID part
      // of `fromExplicit` if it looks like `<uuid>@<host>` (legacy address form).
      (typeof fromExplicit === 'string' && /^[0-9a-f]{8}-/i.test(fromExplicit.split('@')[0] ?? '')
        ? fromExplicit.split('@')[0]
        : null);
    const toUuidPart = to.split('@')[0] ?? '';
    if (
      fromUuid &&
      toUuidPart &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(toUuidPart) &&
      toUuidPart.toLowerCase() === fromUuid.toLowerCase()
    ) {
      return Response.json(
        {
          error: 'Cannot send to self',
          code: 'SELF_MESSAGE_NOT_ALLOWED',
        },
        { status: 400 }
      );
    }

    // v0.14.2: Reject unregistered recipient. When a `resolver` (the
    // `resolveIdentifier` wired by the server to `findAgentByEmailOrAddress`)
    // is available, use it to confirm `to` resolves to a registered agent.
    //
    // Resolution cases:
    //   - `toRaw` is an email and resolves to a known agent → keep canonical `to`
    //   - `toRaw` is an email and DOES NOT resolve → 404 RECIPIENT_NOT_FOUND
    //   - `toRaw` is already `<uuid>@<host>` → trust the format (UUID match
    //     above already validated the format; we don't re-query the DB here
    //     to keep the fast path for legacy callers)
    //   - No resolver wired (e.g. server running without bountyDb) →
    //     pass-through (preserves pre-v0.14.2 behavior of accepting arbitrary
    //     strings for external systems)
    //
    // Why 404 instead of accepting the message: the canonical `to` already
    // gets resolved to `<recipient>@<host>` for the push path; if the
    // recipient isn't registered, the message would be silently stored
    // unread forever. Surfacing the error early gives the CLI a clear
    // signal to retry with a corrected address.
    if (this.resolveIdentifier && !to.includes('@authenticated')) {
      const lookedUp = this.resolveIdentifier(toRaw);
      if (lookedUp == null) {
        // Only reject if `toRaw` looks like an email/identifier the resolver
        // is supposed to handle. If it looks like a UUID-host address, the
        // caller probably has internal machinery we can't validate against;
        // pass-through preserves legacy compatibility for that path.
        const isUuidHost =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}@/i.test(toRaw);
        if (!isUuidHost) {
          return Response.json(
            {
              error: `Recipient email not registered: ${toRaw}`,
              code: 'RECIPIENT_NOT_FOUND',
            },
            { status: 404 }
          );
        }
      }
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

    // v0.14.1: enrich response with registered emails so the CLI can show
    // "From: alice@example.com" instead of "<uuid>@authenticated".
    // - from_email: resolve the canonical `from` field (e.g. `<uuid>@authenticated`
    //   or the raw `fromExplicit` value)
    // - to_email: resolve the canonical `to` field (after normalization)
    // - resolver fallback: raw input string when the resolver is missing
    //   or returns null (unknown / external recipient)
    const fromEmail = this.resolveEmailForResponse(from, fromExplicit);
    const toEmail = this.resolveEmailForResponse(to, toRaw);

    return Response.json(
      { ...message, from_email: fromEmail, to_email: toEmail },
      { status: 201 }
    );
  }

  /**
   * v0.14.1: Resolve a canonical/raw agent identifier to the registered
   * email for response enrichment.
   *
   * Strategy:
   * 1. Try the wired `resolveEmail` (which uses `findAgentByEmailOrAddress`).
   * 2. If that returns null, fall back to the **raw** identifier (the value
   *    the user submitted). This keeps the response shape stable when
   *    recipients are unknown / external systems.
   */
  private resolveEmailForResponse(canonical: string, rawFallback: string | null): string {
    if (this.resolveEmail) {
      const resolved = this.resolveEmail(canonical);
      if (resolved) return resolved;
    }
    // Fallback: prefer the canonical value (may look like `<uuid>@<host>`
    // for authenticated senders — but that's better than nothing). When the
    // canonical is the @authenticated form (i.e. the sender), the resolver
    // already returned null in the test path because there's no registered
    // email keyed by `<uuid>@authenticated`; fall back to `rawFallback`
    // (the body.from_email / body.from that the client submitted) instead.
    if (canonical && canonical !== 'anonymous@server.com') {
      // Try resolver one more time on the raw fallback (e.g. user submitted
      // a real email that wasn't pre-resolved into `to`).
      if (rawFallback && rawFallback !== canonical && this.resolveEmail) {
        const r = this.resolveEmail(rawFallback);
        if (r) return r;
      }
      return canonical;
    }
    return rawFallback || canonical;
  }

  getMessages(url: URL, requester: RequesterInfo): Response {
    // v0.14 BREAKING (RC-3): legacy `?address=` query is REMOVED.
    // Only `?email=<registered-email>` is accepted. Reject 400 'use ?email='.
    const legacyAddress = url.searchParams.get('address');
    if (legacyAddress && legacyAddress.trim()) {
      return Response.json(
        { error: 'use ?email=<your-registered-email> (v0.14 BREAKING: legacy ?address= removed)' },
        { status: 400 }
      );
    }
    const rawIdentifier = normalizeAgentIdentifier(url.searchParams.get('email'));
    if (!rawIdentifier) {
      return Response.json(
        { error: 'Missing required query parameter: email' },
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
    // v0.14.1: enrich each message with from_email / to_email so the CLI can
    // display registered emails instead of canonical addresses. We resolve
    // each canonical address via the wired resolver; on miss we fall back
    // to the canonical itself so the response shape stays stable.
    const enriched = messages.map((m) => ({
      ...m,
      from_email: this.resolveEmail?.(m.from) ?? m.from,
      to_email: this.resolveEmail?.(m.to) ?? m.to,
    }));
    return Response.json(enriched);
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
    // v0.14 BREAKING (RC-3): legacy `?address=` query is REMOVED.
    // Only `?email=<registered-email>` is accepted. Reject 400 'use ?email='.
    const legacyAddress = url.searchParams.get('address');
    if (legacyAddress && legacyAddress.trim()) {
      return Response.json(
        { error: 'use ?email=<your-registered-email> (v0.14 BREAKING: legacy ?address= removed)' },
        { status: 400 }
      );
    }
    const address = normalizeAgentIdentifier(url.searchParams.get('email'));
    if (!address) {
      return Response.json(
        { error: 'Missing required query parameter: email' },
        { status: 400 }
      );
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
