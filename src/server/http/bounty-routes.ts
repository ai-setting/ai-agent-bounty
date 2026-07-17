/**
 * Bounty Routes
 *
 * Thin HTTP layer over BountyService. All business logic (escrow,
 * credit accounting, status transitions) lives in BountyService; this
 * module is responsible for:
 *   - request body parsing + validation
 *   - looking up the agent by email OR address (v0.13 email-first)
 *     and resolving the publisher/agent identity
 *   - mapping service return values to HTTP responses
 *
 * Endpoints:
 *   GET  /api/tasks
 *   POST /api/tasks
 *   PUT  /api/tasks/:id/grab
 *   PUT  /api/tasks/:id/submit
 *   PUT  /api/tasks/:id/complete
 *   PUT  /api/tasks/:id/cancel
 *   PUT  /api/tasks/:id/dispute
 *   GET  /api/tasks/:id
 *
 * v0.7 additions:
 *   - Handlers accept `*Address` (uuid@host or bare uuid) in addition to
 *     legacy `*Id` (auth-derived or explicit body field).
 *   - When `BOUNTY_TOKEN_CHECK_ENABLED=false`, `agentId` is `undefined`;
 *     callers MUST supply an address in the body.
 *
 * v0.13 additions:
 *   - Handlers now accept `*Email` (the agents.email UNIQUE column) as
 *     the PRIMARY lookup key. `*Address` is preserved as a fallback for
 *     legacy callers.
 *   - Callers SHOULD migrate from `*Address` to `*Email`. The legacy
 *     form continues to work and is wired through `findAgentByAddress`.
 */

import type { Database } from '../../lib/storage/database';
import { BountyService, type Task, type TaskFilter, TaskStatus } from '../../lib/bounty/index.js';
import { AgentService } from '../../lib/agent/index.js';
import {
  findAgentByAddress,
  findAgentByEmail,
  findAgentByEmailOrAddress,
} from '../lib/address-resolver.js';

interface JsonBody {
  [k: string]: unknown;
}

async function readJson(req: Request): Promise<JsonBody | null> {
  const text = await req.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as JsonBody;
  } catch {
    return undefined as unknown as null;
  }
}

function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

function notFound(message = 'Not found'): Response {
  return Response.json({ error: message }, { status: 404 });
}

function forbidden(message: string): Response {
  return Response.json({ error: message }, { status: 403 });
}

function internalError(message = 'Internal server error'): Response {
  return Response.json({ error: message }, { status: 500 });
}

/**
 * v0.14 helper: invoke `resolveActor` and convert `{ error }` into a
 * ready-to-return Response. Used by all command handlers in this file.
 */
function resolveActorOrError(
  db: Database,
  body: Record<string, unknown>,
  fieldName: 'publisher' | 'agent',
  authId: string | undefined
): { actor: { id: string; email: string } } | Response {
  const r = resolveActor(db, body, fieldName, authId);
  if ('error' in r) {
    return Response.json({ error: r.error.message }, { status: r.error.status });
  }
  return r;
}

/**
 * Resolve the acting agent from request body + auth fallback.
 *
 * v0.14 STRICT email-only contract:
 *   - ONLY `body[${fieldName}Email]` is accepted as actor identity input.
 *   - `body[${fieldName}Address]` (legacy `<uuid>@<host>`) is REJECTED
 *     with HTTP 400 'use ${fieldName}Email: <registered-email>'. Per
 *     parent task description: '彻底移除 agent address、short address、
 *     uuid 以及任何隐式 fallback/兼容分支'.
 *   - `authId` (from JWT) is still accepted as the implicit caller when
 *     `BOUNTY_TOKEN_CHECK_ENABLED=true`.
 *
 * Returns:
 *   - `{ actor: { id, email } }` on success
 *   - `{ error: { status, message } }` on legacy / missing / not-found
 *     Caller converts to HTTP response.
 */
function resolveActor(
  db: Database,
  body: Record<string, unknown>,
  fieldName: 'publisher' | 'agent',
  authId: string | undefined
): { actor: { id: string; email: string } } | { error: { status: number; message: string } } {
  const emailKey = `${fieldName}Email` as const;
  const addrKey = `${fieldName}Address` as const;

  // v0.14 BREAKING: reject legacy `*Address` body field with 400. No
  // silent fallback — this is the entire point of the v0.14 refactor.
  const addr = body[addrKey];
  if (typeof addr === 'string' && addr.trim()) {
    return {
      error: {
        status: 400,
        message: `use ${emailKey}: <your-registered-email> (v0.14 BREAKING: legacy ${addrKey} removed)`,
      },
    };
  }

  // 1. email field (PRIMARY in v0.13+; ONLY in v0.14)
  const email = body[emailKey];
  if (typeof email === 'string' && email.trim()) {
    const r = findAgentByEmail(db, email);
    if (!r) {
      return {
        error: {
          status: 404,
          message: `No registered agent for email '${email}'`,
        },
      };
    }
    return { actor: { id: r.id, email: r.email } };
  }

  // 2. authId (JWT-based)
  if (authId) {
    const row = db
      .prepare('SELECT id, email FROM agents WHERE id = ?')
      .get(authId) as { id: string; email: string } | undefined;
    if (row) return { actor: row };
  }

  return {
    error: {
      status: 400,
      message: `use ${emailKey}: <your-registered-email> (or supply a valid JWT)`,
    },
  };
}

export class BountyRoutes {
  private db: Database;
  private bountyService: BountyService;

  constructor(db: Database) {
    this.db = db;
    this.bountyService = new BountyService(db, new AgentService(db));
  }

  // ===== Queries =====

  /**
   * v0.14 FB-1 fix: `?publisherId=<email>` (the CLI's v0.14 wire shape for
   * `bounty bounty-task board --publisher-email <email>`) is translated to
   * agent.id BEFORE the BountyService.list() WHERE clause. Without this,
   * the server compares the email string to the UUID column and returns
   * an empty list (silent mis-route). UUID-shaped input continues to work
   * as before for backward-compat with internal / k8s callers.
   *
   * v0.14 also rejects malformed email input (returns empty list, not 400,
   * to preserve `list()` semantics — a filter that matches no rows is
   * semantically equivalent to "no such agent").
   */
  getTasks(url: URL): Response {
    const filter: TaskFilter = {};
    const status = url.searchParams.get('status');
    if (status) filter.status = status as TaskStatus;
    const type = url.searchParams.get('type');
    if (type) filter.type = type;
    const publisherIdRaw = url.searchParams.get('publisherId');
    if (publisherIdRaw && publisherIdRaw.trim()) {
      const resolved = this.resolvePublisherIdFilter(publisherIdRaw.trim());
      if (resolved === null) {
        // Unregistered valid-format email → empty list (not 404 — list()
        // semantics: a filter that matches no agent returns no rows).
        return Response.json([]);
      }
      filter.publisherId = resolved;
    }
    const assigneeId = url.searchParams.get('assigneeId');
    if (assigneeId) filter.assigneeId = assigneeId;

    const tasks = this.bountyService.list(filter);
    return Response.json(tasks);
  }

  /**
   * v0.14 FB-1: Resolve a `?publisherId=` query value to a canonical
   * `agent.id` (UUID). Accepts BOTH:
   *   - registered email shape (e.g. `alice@example.com`) — resolved via
   *     findAgentByEmail
   *   - UUID shape (already an internal agent.id) — returned as-is
   *
   * Returns:
   *   - `agent.id` (UUID) on hit
   *   - `null` (sentinel for "filter matched no agent — return empty")
   *   - `string` (raw UUID) for UUID-shape input
   *
   * Caller (getTasks) distinguishes `null` from `string` and short-circuits
   * to an empty array, preserving list() semantics that a no-match filter
   * returns an empty list (not 404). This avoids leaking an "unregistered"
   * distinction for a query that is semantically a filter, not a fetch.
   */
  private resolvePublisherIdFilter(value: string): string | null {
    // Email-shape input: resolve to agent.id via findAgentByEmail.
    if (value.includes('@')) {
      const agent = findAgentByEmail(this.db, value);
      if (!agent) return null; // sentinel: no such agent → empty list
      return agent.id;
    }
    // UUID-shape input: assume it's already an internal agent.id.
    // (No further validation — list() will simply return 0 rows on miss.)
    return value;
  }

  getTaskById(taskId: string): Response {
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    return Response.json(task);
  }

  // ===== Commands =====

  async createTask(req: Request, authId: string | undefined): Promise<Response> {
    const body = await readJson(req);
    if (body === null) return badRequest('Missing request body');
    if (body === undefined) return badRequest('Invalid JSON');

    const { title, description, reward, type } = body as {
      title?: unknown;
      description?: unknown;
      reward?: unknown;
      type?: unknown;
    };

    if (typeof title !== 'string' || !title.trim()) {
      return badRequest('Missing required field: title');
    }

    // 容错: description 可选 → 缺失用空串, 但最终需要非空 (向后兼容测试)
    const safeDescription = typeof description === 'string' ? description.trim() : '';
    if (!safeDescription) {
      return badRequest('Missing required field: description');
    }

    // 容错: reward 类型不对 → 友好提示
    if (reward !== undefined && (typeof reward !== 'number' || !(reward > 0))) {
      return badRequest('reward must be a positive number');
    }
    const safeReward = typeof reward === 'number' && reward > 0 ? reward : 0;
    if (safeReward === 0) {
      return badRequest('Missing required field: reward (must be > 0)');
    }

    const taskType = typeof type === 'string' && type.trim() ? type : 'bounty';

    // 解析 publisher (email 优先 → address → auth)
    const publisherResult = resolveActorOrError(this.db, body, 'publisher', authId);
    if (publisherResult instanceof Response) return publisherResult;
    const publisher = publisherResult.actor;
    try {
      const task = this.bountyService.publish({
        title: title.trim(),
        description: safeDescription,
        type: taskType,
        reward: safeReward,
        publisherId: publisher.id,
        publisherEmail: publisher.email,
      });
      return Response.json(task, { status: 201 });
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Publish failed');
    }
  }

  async grabTask(req: Request, taskId: string, authId: string | undefined): Promise<Response> {
    // v0.7: grabTask reads body for agentAddress
    let body: JsonBody = {};
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text) as JsonBody;
      } catch {
        return badRequest('Invalid JSON');
      }
    }

    const agentResult = resolveActorOrError(this.db, body, 'agent', authId);
    if (agentResult instanceof Response) return agentResult;
    const agent = agentResult.actor;
    const result = this.bountyService.grab(taskId, agent.id, agent.email);
    if (!result.success) {
      // D.1: distinguish "already grabbed" (409 Conflict) from generic 400.
      if (result.reason === 'Task not found') {
        return notFound('Task not found');
      }
      if (result.reason!.startsWith('Task is not open')) {
        const current = this.db
          .prepare(
            `SELECT t.status, t.assignee_id, t.assignee_email, a.name AS assignee_name
               FROM tasks t
               LEFT JOIN agents a ON a.id = t.assignee_id
              WHERE t.id = ?`
          )
          .get(taskId) as
          | { status: string; assignee_id: string | null; assignee_email: string | null; assignee_name: string | null }
          | undefined;
        const currentOwner =
          current && current.assignee_id && current.assignee_email
            ? {
                id: current.assignee_id,
                email: current.assignee_email,
                name: current.assignee_name ?? undefined,
              }
            : undefined;
        return Response.json(
          {
            error: result.reason,
            currentStatus: current?.status,
            currentOwner,
          },
          { status: 409 }
        );
      }
      return badRequest(result.reason!);
    }

    const task = this.bountyService.getById(taskId);
    return Response.json(task);
  }

  async submitTask(req: Request, taskId: string, authId: string | undefined): Promise<Response> {
    const body = (await readJson(req)) ?? {};
    if (body === undefined) return badRequest('Invalid JSON');

    // 容错: result 可选 → 缺失/非字符串用空串, 但最终需要非空
    const resultText = typeof body.result === 'string' ? body.result.trim() : '';
    if (!resultText) return badRequest('Missing required field: result');

    const agentResult = resolveActorOrError(this.db, body, 'agent', authId);
    if (agentResult instanceof Response) return agentResult;
    const agent = agentResult.actor;
    const result = this.bountyService.submit(taskId, agent.id, resultText);
    if (!result.success) {
      const status = result.reason === 'Task not found' ? 404 : 400;
      return Response.json({ error: result.reason }, { status });
    }
    const task = this.bountyService.getById(taskId);
    return Response.json(task);
  }

  async completeTask(req: Request, taskId: string, authId: string | undefined): Promise<Response> {
    let body: JsonBody = {};
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text) as JsonBody;
      } catch {
        return badRequest('Invalid JSON');
      }
    }

    const publisherResult = resolveActorOrError(this.db, body, 'publisher', authId);
    if (publisherResult instanceof Response) return publisherResult;
    const publisher = publisherResult.actor;
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== publisher.id) {
      return forbidden('Only the publisher can complete the task');
    }
    const result = this.bountyService.complete(taskId, publisher.id);
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });    }
    return Response.json(this.bountyService.getById(taskId));
  }

  async cancelTask(req: Request, taskId: string, authId: string | undefined): Promise<Response> {
    let body: JsonBody = {};
    const text = await req.text();
    if (text) {
      try {
        body = JSON.parse(text) as JsonBody;
      } catch {
        return badRequest('Invalid JSON');
      }
    }

    const publisherResult = resolveActorOrError(this.db, body, 'publisher', authId);
    if (publisherResult instanceof Response) return publisherResult;
    const publisher = publisherResult.actor;
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== publisher.id) {
      return forbidden('Only the publisher can cancel the task');
    }
    const result = this.bountyService.cancel(taskId, publisher.id);
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json(this.bountyService.getById(taskId));
  }

  async disputeTask(req: Request, taskId: string, authId: string | undefined): Promise<Response> {
    const body = (await readJson(req)) ?? {};
    if (body === undefined) return badRequest('Invalid JSON');

    // 容错: reason 可选 → 缺失用空串, 但最终需要非空
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (!reason) return badRequest('Missing required field: reason');

    const publisherResult = resolveActorOrError(this.db, body, 'publisher', authId);
    if (publisherResult instanceof Response) return publisherResult;
    const publisher = publisherResult.actor;
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== publisher.id) {
      return forbidden('Only the publisher can dispute the task');
    }
    const result = this.bountyService.dispute(taskId, publisher.id, reason);
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json(this.bountyService.getById(taskId));
  }
}
