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
