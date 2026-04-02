/**
 * Bounty Task Management
 * Task publishing, grabbing, completing, and escrow
 */

import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database.js';
import { AgentService } from '../agent/index.js';

// Task status constants
export const TaskStatus = {
  OPEN: 'open',
  GRABBED: 'grabbed',
  SUBMITTED: 'submitted',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;

export type TaskStatus = typeof TaskStatus[keyof typeof TaskStatus];

// Escrow status constants
export const EscrowStatus = {
  LOCKED: 'locked',
  RELEASED: 'released',
  CANCELLED: 'cancelled',
  DISPUTED: 'disputed',
} as const;

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

/**
 * Helper function to execute a transaction on a raw SQLite database
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTransaction(db: any, callback: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    callback();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export class BountyService {
  private db: Database;
  private agentService: AgentService;

  constructor(db: Database, agentService: AgentService) {
    this.db = db;
    this.agentService = agentService;
  }

  /**
   * Execute a transaction
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private runInTx(callback: () => void): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawDb = (this.db as any).db;
    runTransaction(rawDb, callback);
  }

  /**
   * Validate publish input
   */
  private validatePublishInput(input: PublishTaskInput): void {
    if (!input.title || input.title.trim().length === 0) {
      throw new Error('Title is required and cannot be empty');
    }
    if (input.title.length > 200) {
      throw new Error('Title must be 200 characters or less');
    }
    if (!input.description || input.description.trim().length === 0) {
      throw new Error('Description is required and cannot be empty');
    }
    if (!input.type || input.type.trim().length === 0) {
      throw new Error('Type is required');
    }
    if (typeof input.reward !== 'number' || input.reward <= 0) {
      throw new Error('Reward must be a positive number');
    }
    if (input.reward > 1000000) {
      throw new Error('Reward exceeds maximum allowed (1,000,000)');
    }
    if (!input.publisherId || input.publisherId.trim().length === 0) {
      throw new Error('Publisher ID is required');
    }
    if (!input.publisherEmail || !input.publisherEmail.includes('@')) {
      throw new Error('Valid publisher email is required');
    }
    if (input.deadline && input.deadline <= Date.now()) {
      throw new Error('Deadline must be in the future');
    }
  }

  /**
   * Publish a new bounty task (with transaction)
   */
  publish(input: PublishTaskInput): Task {
    // Validate input first
    this.validatePublishInput(input);

    const now = Date.now();
    const id = uuidv4();
    const escrowId = uuidv4();

    // Use transaction for atomicity
    this.runInTx(() => {
      // Deduct credits from publisher (创建托管)
      this.agentService.updateCredits(
        input.publisherId,
        input.reward,
        'deduct',
        `Publish task: ${input.title}`
      );

      // Create task
      this.db.prepare(`
        INSERT INTO tasks (
          id, title, description, type, reward, publisher_id, publisher_email,
          status, tags, requirements, deadline, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        input.title.trim(),
        input.description.trim(),
        input.type.trim(),
        input.reward,
        input.publisherId,
        input.publisherEmail,
        TaskStatus.OPEN,
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
      `).run(escrowId, id, input.publisherId, input.reward, EscrowStatus.LOCKED, now, now);
    });

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
   * Grab a task (抢单) - with transaction and concurrency safety
   */
  grab(taskId: string, agentId: string, agentEmail: string): GrabResult {
    if (!agentId || !agentEmail) {
      return { success: false, reason: 'Agent ID and email are required' };
    }

    const now = Date.now();

    // Use transaction with optimistic locking
    try {
      let grabbedTaskId: string | null = null;
      this.runInTx(() => {
        // Use conditional update to prevent race conditions
        // Only update if status is still 'open' (乐观锁)
        const updateResult = this.db.prepare(`
          UPDATE tasks SET 
            status = ?,
            assignee_id = ?,
            assignee_email = ?,
            updated_at = ?
          WHERE id = ? AND status = ?
        `).run(TaskStatus.GRABBED, agentId, agentEmail, now, taskId, TaskStatus.OPEN);

        if (updateResult.changes === 0) {
          // Either task doesn't exist or already grabbed
          const currentTask = this.getById(taskId);
          if (!currentTask) {
            throw new Error('Task not found');
          }
          throw new Error(`Task is not open (current status: ${currentTask.status})`);
        }

        // Cannot grab your own task (double check)
        const task = this.getById(taskId);
        if (task && task.publisherId === agentId) {
          throw new Error('Cannot grab your own task');
        }

        // Update escrow
        this.db.prepare(`
          UPDATE escrows SET 
            provider_id = ?,
            updated_at = ?
          WHERE task_id = ? AND status = ?
        `).run(agentId, now, taskId, EscrowStatus.LOCKED);

        grabbedTaskId = taskId;
      });

      return { success: true, escrowId: grabbedTaskId! };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Submit task result (提交完成)
   */
  submit(taskId: string, agentId: string, result: string): CompleteResult {
    if (!result || result.trim().length === 0) {
      return { success: false, reason: 'Result is required' };
    }

    try {
      this.runInTx(() => {
        const task = this.getById(taskId);
        if (!task) {
          throw new Error('Task not found');
        }

        if (task.status !== TaskStatus.GRABBED) {
          throw new Error(`Task cannot be submitted (current status: ${task.status})`);
        }

        if (task.assigneeId !== agentId) {
          throw new Error('You are not the assignee of this task');
        }

        const now = Date.now();

        this.db.prepare(`
          UPDATE tasks SET 
            status = ?,
            result = ?,
            updated_at = ?
          WHERE id = ?
        `).run(TaskStatus.SUBMITTED, result.trim(), now, taskId);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Complete task (验收通过，释放积分) - with transaction
   */
  complete(taskId: string, publisherId: string): CompleteResult {
    try {
      this.runInTx(() => {
        const task = this.getById(taskId);
        if (!task) {
          throw new Error('Task not found');
        }

        if (task.status !== TaskStatus.SUBMITTED) {
          throw new Error(`Task cannot be completed (current status: ${task.status})`);
        }

        if (task.publisherId !== publisherId) {
          throw new Error('Only the publisher can complete the task');
        }

        const now = Date.now();

        // Update task
        this.db.prepare(`
          UPDATE tasks SET 
            status = ?,
            completed_at = ?,
            updated_at = ?
          WHERE id = ?
        `).run(TaskStatus.COMPLETED, now, now, taskId);

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
            status = ?,
            released_at = ?,
            updated_at = ?
          WHERE task_id = ? AND status = ?
        `).run(EscrowStatus.RELEASED, now, now, taskId, EscrowStatus.LOCKED);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Cancel task - with transaction
   */
  cancel(taskId: string, agentId: string): CompleteResult {
    try {
      this.runInTx(() => {
        const task = this.getById(taskId);
        if (!task) {
          throw new Error('Task not found');
        }

        if (task.publisherId !== agentId) {
          throw new Error('Only the publisher can cancel the task');
        }

        if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
          throw new Error(`Task cannot be cancelled (current status: ${task.status})`);
        }

        const now = Date.now();

        // Update task
        this.db.prepare(`
          UPDATE tasks SET 
            status = ?,
            updated_at = ?
          WHERE id = ?
        `).run(TaskStatus.CANCELLED, now, taskId);

        // Refund escrow to publisher (if no assignee)
        if (task.status === TaskStatus.OPEN) {
          this.agentService.updateCredits(
            task.publisherId,
            task.reward,
            'reward',
            `Task cancelled: ${task.title} - refund`
          );

          this.db.prepare(`
            UPDATE escrows SET 
              status = ?,
              updated_at = ?
            WHERE task_id = ? AND status = ?
          `).run(EscrowStatus.CANCELLED, now, taskId, EscrowStatus.LOCKED);
        }
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
  }

  /**
   * Dispute task (发起争议) - with transaction
   */
  dispute(taskId: string, agentId: string, reason: string): CompleteResult {
    if (!reason || reason.trim().length === 0) {
      return { success: false, reason: 'Dispute reason is required' };
    }

    try {
      this.runInTx(() => {
        const task = this.getById(taskId);
        if (!task) {
          throw new Error('Task not found');
        }

        if (task.status !== TaskStatus.SUBMITTED) {
          throw new Error(`Task cannot be disputed (current status: ${task.status})`);
        }

        if (task.publisherId !== agentId) {
          throw new Error('Only the publisher can dispute the task');
        }

        const now = Date.now();

        this.db.prepare(`
          UPDATE tasks SET 
            status = ?,
            result = ? || '\n[Dispute]: ' || ?,
            updated_at = ?
          WHERE id = ?
        `).run(TaskStatus.DISPUTED, task.result || '', reason.trim(), now, taskId);

        this.db.prepare(`
          UPDATE escrows SET 
            status = ?,
            updated_at = ?
          WHERE task_id = ? AND status = ?
        `).run(EscrowStatus.DISPUTED, now, taskId, EscrowStatus.LOCKED);
      });

      return { success: true };
    } catch (error: any) {
      return { success: false, reason: error.message };
    }
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
