/**
 * Bounty Routes
 *
 * Thin HTTP layer over BountyService. All business logic (escrow,
 * credit accounting, status transitions) lives in BountyService; this
 * module is responsible for:
 *   - request body parsing + validation
 *   - looking up the agent by id and resolving the publisher email
 *   - mapping service return values to HTTP responses
 *
 * Endpoints:
 *   GET  /api/tasks
 *   POST /api/tasks
 *   PUT  /api/tasks/:id/grab
 *   PUT  /api/tasks/:id/submit
 *   PUT  /api/tasks/:id/complete   (added in H1)
 *   PUT  /api/tasks/:id/cancel     (added in H1)
 *   PUT  /api/tasks/:id/dispute    (added in H1)
 *   GET  /api/tasks/:id            (added in H1)
 */

import type { Database } from '../../lib/storage/database';
import { BountyService, type Task, type TaskFilter, TaskStatus } from '../../lib/bounty/index.js';
import { AgentService } from '../../lib/agent/index.js';

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

export class BountyRoutes {
  private db: Database;
  private bountyService: BountyService;

  constructor(db: Database) {
    this.db = db;
    this.bountyService = new BountyService(db, new AgentService(db));
  }

  // ===== Queries =====

  getTasks(url: URL): Response {
    const filter: TaskFilter = {};
    const status = url.searchParams.get('status');
    if (status) filter.status = status as TaskStatus;
    const type = url.searchParams.get('type');
    if (type) filter.type = type;
    const publisherId = url.searchParams.get('publisherId');
    if (publisherId) filter.publisherId = publisherId;
    const assigneeId = url.searchParams.get('assigneeId');
    if (assigneeId) filter.assigneeId = assigneeId;

    const tasks = this.bountyService.list(filter);
    return Response.json(tasks);
  }

  getTaskById(taskId: string): Response {
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    return Response.json(task);
  }

  // ===== Commands =====

  async createTask(req: Request, agentId: string): Promise<Response> {
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
    if (typeof description !== 'string' || !description.trim()) {
      return badRequest('Missing required field: description');
    }
    if (typeof reward !== 'number' || !(reward > 0)) {
      return badRequest('Missing required field: reward (must be > 0)');
    }
    const taskType = typeof type === 'string' && type.trim() ? type : 'bounty';

    const agent = this.db
      .prepare('SELECT email FROM agents WHERE id = ?')
      .get(agentId) as { email: string } | undefined;
    if (!agent) return notFound('Agent not found');

    try {
      const task = this.bountyService.publish({
        title: title.trim(),
        description: description.trim(),
        type: taskType,
        reward,
        publisherId: agentId,
        publisherEmail: agent.email,
      });
      return Response.json(task, { status: 201 });
    } catch (err) {
      return badRequest(err instanceof Error ? err.message : 'Publish failed');
    }
  }

  grabTask(taskId: string, agentId: string): Response {
    const agent = this.db
      .prepare('SELECT email FROM agents WHERE id = ?')
      .get(agentId) as { email: string } | undefined;
    if (!agent) return notFound('Agent not found');

    const result = this.bountyService.grab(taskId, agentId, agent.email);
    if (!result.success) {
      // D.1: distinguish "already grabbed" (409 Conflict) from generic 400.
      // The DB-level optimistic lock already ensures only one writer wins;
      // surfacing 409 + currentOwner lets clients tell the user *who* won.
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

  async submitTask(req: Request, taskId: string, agentId: string): Promise<Response> {
    const body = await readJson(req);
    if (body === undefined) return badRequest('Invalid JSON');
    const resultText = (body?.result as unknown);
    if (typeof resultText !== 'string') {
      return badRequest('Missing required field: result');
    }
    const result = this.bountyService.submit(taskId, agentId, resultText);
    if (!result.success) {
      const status = result.reason === 'Task not found' ? 404 : 400;
      return Response.json({ error: result.reason }, { status });
    }
    const task = this.bountyService.getById(taskId);
    return Response.json(task);
  }

  async completeTask(_req: Request, taskId: string, agentId: string): Promise<Response> {
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== agentId) {
      return forbidden('Only the publisher can complete the task');
    }
    const result = this.bountyService.complete(taskId, agentId);
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json(this.bountyService.getById(taskId));
  }

  async cancelTask(_req: Request, taskId: string, agentId: string): Promise<Response> {
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== agentId) {
      return forbidden('Only the publisher can cancel the task');
    }
    const result = this.bountyService.cancel(taskId, agentId);
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json(this.bountyService.getById(taskId));
  }

  async disputeTask(req: Request, taskId: string, agentId: string): Promise<Response> {
    const body = await readJson(req);
    if (body === undefined) return badRequest('Invalid JSON');
    const reason = body?.reason as unknown;
    if (typeof reason !== 'string' || !reason.trim()) {
      return badRequest('Missing required field: reason');
    }
    const task = this.bountyService.getById(taskId);
    if (!task) return notFound('Task not found');
    if (task.publisherId !== agentId) {
      return forbidden('Only the publisher can dispute the task');
    }
    const result = this.bountyService.dispute(taskId, agentId, reason.trim());
    if (!result.success) {
      return Response.json({ error: result.reason }, { status: 400 });
    }
    return Response.json(this.bountyService.getById(taskId));
  }
}
