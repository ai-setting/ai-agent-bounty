/**
 * Agent registry and management
 */

import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database.js';

export interface Agent {
  id: string;
  name: string;
  email: string;
  description?: string;
  publicKey?: string;
  credits: number;
  status: 'active' | 'suspended' | 'pending';
  createdAt: number;
  updatedAt: number;
}

export interface RegisterAgentInput {
  name: string;
  email: string;
  description?: string;
  publicKey?: string;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  publicKey?: string;
  status?: 'active' | 'suspended';
}

export class AgentService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Register a new agent
   */
  register(input: RegisterAgentInput): Agent {
    const now = Date.now();
    const id = uuidv4();
    
    // Check if email already exists
    const existing = this.db.prepare('SELECT id FROM agents WHERE email = ?').get(input.email);
    if (existing) {
      throw new Error(`Agent with email ${input.email} already exists`);
    }

    const stmt = this.db.prepare(`
      INSERT INTO agents (id, name, email, description, public_key, credits, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      input.name,
      input.email,
      input.description || null,
      input.publicKey || null,
      100, // Initial credits
      'active',
      now,
      now
    );

    // Record initial credit transaction
    this.db.prepare(`
      INSERT INTO credit_transactions (id, agent_id, amount, type, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, 100, 'reward', 'Welcome bonus', now);

    return this.getById(id)!;
  }

  /**
   * Get agent by ID
   */
  getById(id: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * Get agent by email
   */
  getByEmail(email: string): Agent | null {
    const row = this.db.prepare('SELECT * FROM agents WHERE email = ?').get(email) as any;
    return row ? this.mapRow(row) : null;
  }

  /**
   * List all agents
   */
  list(filter?: { status?: string }): Agent[] {
    let query = 'SELECT * FROM agents';
    const params: any[] = [];
    
    if (filter?.status) {
      query += ' WHERE status = ?';
      params.push(filter.status);
    }
    
    query += ' ORDER BY created_at DESC';
    
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(row => this.mapRow(row));
  }

  /**
   * Update agent
   */
  update(id: string, input: UpdateAgentInput): Agent | null {
    const agent = this.getById(id);
    if (!agent) {
      return null;
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (input.name !== undefined) {
      updates.push('name = ?');
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      params.push(input.description);
    }
    if (input.publicKey !== undefined) {
      updates.push('public_key = ?');
      params.push(input.publicKey);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      params.push(input.status);
    }

    if (updates.length === 0) {
      return agent;
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.prepare(`UPDATE agents SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    return this.getById(id);
  }

  /**
   * Update agent credits
   */
  updateCredits(id: string, amount: number, type: 'reward' | 'deduct' | 'transfer', description?: string): boolean {
    const agent = this.getById(id);
    if (!agent) {
      return false;
    }

    const newCredits = type === 'deduct' || type === 'transfer' 
      ? agent.credits - Math.abs(amount)
      : agent.credits + Math.abs(amount);

    if (newCredits < 0) {
      throw new Error(`Insufficient credits. Current: ${agent.credits}, Required: ${Math.abs(amount)}`);
    }

    this.db.prepare('UPDATE agents SET credits = ?, updated_at = ? WHERE id = ?').run(newCredits, Date.now(), id);
    
    // Record transaction
    this.db.prepare(`
      INSERT INTO credit_transactions (id, agent_id, amount, type, description, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(uuidv4(), id, type === 'deduct' ? -Math.abs(amount) : Math.abs(amount), type, description || null, Date.now());

    return true;
  }

  /**
   * Get credit history
   */
  getCreditHistory(id: string, limit = 50): any[] {
    return this.db.prepare(`
      SELECT * FROM credit_transactions 
      WHERE agent_id = ? 
      ORDER BY created_at DESC 
      LIMIT ?
    `).all(id, limit);
  }

  private mapRow(row: any): Agent {
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      description: row.description,
      publicKey: row.public_key,
      credits: row.credits,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
