/**
 * Bounty Task Management
 * Task publishing, grabbing, completing, and escrow
 */

import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database.js';
import { AgentService } from '../agent/index.js';

export type TaskStatus = 'open' | 'grabbed' | 'submitted' | 'completed' | 'cancelled' | 'disputed';

export interface Task {
  id: string;
  title: string;
  description: string;
  type: string;
  reward: number;
  publisherId: string;
  publisherEmail: string;
  status: TaskStatus;
  assigneeId?: string;
  assigneeEmail?: string;
  tags: string[];
  requirements?: string[];
  deadline?: number;
  result?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface PublishTaskInput {
  title: string;
  description: string;
  type: string;
  reward: number;
  publisherId: string;
  publisherEmail: string;
  tags?: string[];
  requirements?: string[];
  deadline?: number;
}

export interface TaskFilter {
  status?: TaskStatus;
  type?: string;
  publisherId?: string;
  assigneeId?: string;
  tags?: string[];
  minReward?: number;
  maxReward?: number;
}

export interface GrabResult {
  success: boolean;
  reason?: string;
  escrowId?: string;
}

export interface CompleteResult {
  success: boolean;
  reason?: string;
}

export class BountyService {
  private db: Database;
  private agentService: AgentService;

  constructor(db: Database, agentService: AgentService) {
    this.db = db;
    this.agentService = agentService;
  }

  /**
   * Publish a new bounty task
   */
  publish(input: PublishTaskInput): Task {
    const now = Date.now();
    const id = uuidv4();
    const escrowId = uuidv4();

    // Deduct credits from publisher (创建托管)
    try {
      this.agentService.updateCredits(
        input.publisherId, 
        input.reward, 
        'deduct', 
        `Publish task: ${input.title}`
      );
    } catch (error: any) {
      throw new Error(`Failed to lock reward: ${error.message}`);
    }

    // Create task
    const stmt = this.db.prepare(`
      INSERT INTO tasks (
        id, title, description, type, reward, publisher_id, publisher_email,
        status, tags, requirements, deadline, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.title,
      input.description,
      input.type,
      input.reward,
      input.publisherId,
      input.publisherEmail,
      'open',
      JSON.stringify(input.tags || []),
      JSON.stringify(input.requirements || []),
      input.deadline || null,
      now,
      now
    );

    // Create escrow
    this.db.prepare(`
      INSERT INTO escrows (id, task_id, issuer_id, amount, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(escrowId, id, input.publisherId, input.reward, 'locked', now, now);

    return this.getById(id)!;
  }

  /**
   * Get task by ID
   */
  getById(id: string): Task | null {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * List tasks with filter
   */
  list(filter?: TaskFilter): Task[] {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];

    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    if (filter?.type) {
      query += ' AND type = ?';
      params.push(filter.type);
    }
    if (filter?.publisherId) {
      query += ' AND publisher_id = ?';
      params.push(filter.publisherId);
    }
    if (filter?.assigneeId) {
      query += ' AND assignee_id = ?';
      params.push(filter.assigneeId);
    }
    if (filter?.minReward) {
      query += ' AND reward >= ?';
      params.push(filter.minReward);
    }
    if (filter?.maxReward) {
      query += ' AND reward <= ?';
      params.push(filter.maxReward);
    }

    query += ' ORDER BY created_at DESC';

    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Get task board (open tasks)
   */
  getBoard(filter?: TaskFilter): Task[] {
    return this.list({ ...filter, status: 'open' });
  }

  /**
   * Grab a task (抢单)
   */
  grab(taskId: string, agentId: string, agentEmail: string): GrabResult {
    const task = this.getById(taskId);
    if (!task) {
      return { success: false, reason: 'Task not found' };
    }

    if (task.status !== 'open') {
      return { success: false, reason: `Task is not open (current status: ${task.status})` };
    }

    if (task.publisherId === agentId) {
      return { success: false, reason: 'Cannot grab your own task' };
    }

    const now = Date.now();
    
    // Update task
    this.db.prepare(`
      UPDATE tasks SET 
        status = 'grabbed',
        assignee_id = ?,
        assignee_email = ?,
        updated_at = ?
      WHERE id = ?
    `).run(agentId, agentEmail, now, taskId);

    // Update escrow
    this.db.prepare(`
      UPDATE escrows SET 
        provider_id = ?,
        updated_at = ?
      WHERE task_id = ? AND status = 'locked'
    `).run(agentId, now, taskId);

    return { success: true, escrowId: taskId };
  }

  /**
   * Submit task result (提交完成)
   */
  submit(taskId: string, agentId: string, result: string): CompleteResult {
    const task = this.getById(taskId);
    if (!task) {
      return { success: false, reason: 'Task not found' };
    }

    if (task.status !== 'grabbed') {
      return { success: false, reason: `Task cannot be submitted (current status: ${task.status})` };
    }

    if (task.assigneeId !== agentId) {
      return { success: false, reason: 'You are not the assignee of this task' };
    }

    const now = Date.now();
    
    this.db.prepare(`
      UPDATE tasks SET 
        status = 'submitted',
        result = ?,
        updated_at = ?
      WHERE id = ?
    `).run(result, now, taskId);

    return { success: true };
  }

  /**
   * Complete task (验收通过，释放积分)
   */
  complete(taskId: string, publisherId: string): CompleteResult {
    const task = this.getById(taskId);
    if (!task) {
      return { success: false, reason: 'Task not found' };
    }

    if (task.status !== 'submitted') {
      return { success: false, reason: `Task cannot be completed (current status: ${task.status})` };
    }

    if (task.publisherId !== publisherId) {
      return { success: false, reason: 'Only the publisher can complete the task' };
    }

    const now = Date.now();

    // Update task
    this.db.prepare(`
      UPDATE tasks SET 
        status = 'completed',
        completed_at = ?,
        updated_at = ?
      WHERE id = ?
    `).run(now, now, taskId);

    // Release escrow to assignee
    if (task.assigneeId) {
      this.agentService.updateCredits(
        task.assigneeId,
        task.reward,
        'reward',
        `Task completed: ${task.title}`
      );
    }

    // Update escrow
    this.db.prepare(`
      UPDATE escrows SET 
        status = 'released',
        released_at = ?,
        updated_at = ?
      WHERE task_id = ? AND status = 'locked'
    `).run(now, now, taskId);

    return { success: true };
  }

  /**
   * Cancel task
   */
  cancel(taskId: string, agentId: string): CompleteResult {
    const task = this.getById(taskId);
    if (!task) {
      return { success: false, reason: 'Task not found' };
    }

    if (task.publisherId !== agentId) {
      return { success: false, reason: 'Only the publisher can cancel the task' };
    }

    if (task.status === 'completed' || task.status === 'cancelled') {
      return { success: false, reason: `Task cannot be cancelled (current status: ${task.status})` };
    }

    const now = Date.now();

    // Update task
    this.db.prepare(`
      UPDATE tasks SET 
        status = 'cancelled',
        updated_at = ?
      WHERE id = ?
    `).run(now, taskId);

    // Refund escrow to publisher (if no assignee)
    if (task.status === 'open') {
      this.agentService.updateCredits(
        task.publisherId,
        task.reward,
        'reward',
        `Task cancelled: ${task.title} - refund`
      );

      this.db.prepare(`
        UPDATE escrows SET 
          status = 'cancelled',
          updated_at = ?
        WHERE task_id = ? AND status = 'locked'
      `).run(now, taskId);
    }

    return { success: true };
  }

  /**
   * Dispute task (发起争议)
   */
  dispute(taskId: string, agentId: string, reason: string): CompleteResult {
    const task = this.getById(taskId);
    if (!task) {
      return { success: false, reason: 'Task not found' };
    }

    if (task.status !== 'submitted') {
      return { success: false, reason: `Task cannot be disputed (current status: ${task.status})` };
    }

    if (task.publisherId !== agentId) {
      return { success: false, reason: 'Only the publisher can dispute the task' };
    }

    const now = Date.now();

    this.db.prepare(`
      UPDATE tasks SET 
        status = 'disputed',
        result = ? || '\n[Dispute]: ' || ?,
        updated_at = ?
      WHERE id = ?
    `).run(task.result || '', reason, now, taskId);

    this.db.prepare(`
      UPDATE escrows SET 
        status = 'disputed',
        updated_at = ?
      WHERE task_id = ? AND status = 'locked'
    `).run(now, taskId);

    return { success: true };
  }

  private mapRow(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      type: row.type,
      reward: row.reward,
      publisherId: row.publisher_id,
      publisherEmail: row.publisher_email,
      status: row.status,
      assigneeId: row.assignee_id,
      assigneeEmail: row.assignee_email,
      tags: JSON.parse(row.tags || '[]'),
      requirements: JSON.parse(row.requirements || '[]'),
      deadline: row.deadline,
      result: row.result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    };
  }
}
