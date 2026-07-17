/**
 * Auth Routes
 * 
 * Handles authentication endpoints:
 * - POST /api/auth/register
 * - POST /api/auth/verify
 * - POST /api/auth/login
 * - POST /api/auth/send-code
 *
 * v0.13: `POST /api/auth/login` accepts the registered email as the PRIMARY
 * lookup key. The legacy `agent_id` (UUID) field is preserved for callers
 * that have not yet migrated. Both are optional — at least one is required.
 */

import type { Database } from '../../lib/storage/database';
import { register, verify, login, sendVerificationCode } from '../../auth/service.js';
import { parseAddress } from '../../lib/address.js';

export class AuthRoutes {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async register(req: Request): Promise<Response> {
    try {
      let input: { email?: string; name?: string; description?: string; address?: unknown };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.name) {
        return Response.json({ error: 'Email and name are required' }, { status: 400 });
      }
      
      if (!/^[\w.-]+@[\w.-]+\.\w+$/.test(input.email)) {
        return Response.json({ error: 'Invalid email format' }, { status: 400 });
      }

      // v0.7: optional address field validation.
      // Format: uuid@host (e.g. "abc-123@bounty.local")
      // Note: the address is a hint only — the verify step will overwrite it
      // with `${agent_id}@${BOUNTY_DOMAIN}` so callers cannot impersonate.
      // v0.10: strict uuid@host format via shared parser (no inline regex)
      if (input.address !== undefined) {
        const r = parseAddress(input.address, 'address');
        if (!r.ok) {
          return Response.json(
            { error: r.error.replace(/^✗\s*/, '') },
            { status: 400 }
          );
        }
      }
      
      const result = await register(this.db, {
        email: input.email!,
        name: input.name!,
        description: input.description
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  async verify(req: Request): Promise<Response> {
    try {
      let input: { email?: string; code?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email || !input.code) {
        return Response.json({ error: 'Email and code are required' }, { status: 400 });
      }
      
      const result = await verify(this.db, {
        email: input.email!,
        code: input.code!
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Verification failed';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  async login(req: Request): Promise<Response> {
    try {
      let input: { email?: string; agent_id?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email && !input.agent_id) {
        return Response.json({ error: 'Email or agent_id is required' }, { status: 400 });
      }
      
      const result = await login(this.db, {
        email: input.email,
        agent_id: input.agent_id
      });
      return Response.json(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      return Response.json({ error: message }, { status: 401 });
    }
  }

  async sendCode(req: Request): Promise<Response> {
    try {
      let input: { email?: string };
      try {
        const text = await req.text();
        input = JSON.parse(text || '{}');
      } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400 });
      }
      
      if (!input.email) {
        return Response.json({ error: 'Email is required' }, { status: 400 });
      }
      
      await sendVerificationCode(this.db, input.email);
      return Response.json({ message: 'Verification code sent' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send code';
      return Response.json({ error: message }, { status: 400 });
    }
  }

  getCurrentAgent(agentId: string): Response {
    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }
    return Response.json(agent);
  }

  getCurrentAgentCredits(agentId: string): Response {
    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId) as any;
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    const transactions = this.db.prepare(`
      SELECT * FROM credit_transactions 
      WHERE agent_id = ? 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all(agentId);

    return Response.json({
      credits: agent.credits,
      transactions
    });
  }

  listAgents(): Response {
    const agents = this.db.prepare(`
      SELECT id, name, email, status, credits, address, description, created_at, updated_at
      FROM agents
      ORDER BY created_at DESC
    `).all();

    return Response.json(agents);
  }

  getAgentById(id: string): Response {
    const agent = this.db.prepare(`
      SELECT id, name, email, status, credits, address, description, created_at, updated_at
      FROM agents WHERE id = ?
    `).get(id);

    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    return Response.json(agent);
  }

  /**
   * v0.13: Look up an agent by registered email. Used by the
   * `bounty register-agent get --email <email>` CLI path so callers
   * no longer need to know the UUID.
   *
   * Returns the agent row on hit, or 404 when the email is not in the
   * `agents` table.
   */
  getAgentByEmail(email: string): Response {
    if (typeof email !== 'string' || !email.trim()) {
      return Response.json({ error: 'email query parameter is required' }, { status: 400 });
    }
    const agent = this.db.prepare(`
      SELECT id, name, email, status, credits, address, description, created_at, updated_at
      FROM agents WHERE email = ?
    `).get(email.trim());

    if (!agent) {
      return Response.json({ error: `Agent not found for email: ${email}` }, { status: 404 });
    }

    return Response.json(agent);
  }

  deleteAgent(id: string, requesterId: string): Response {
    const agent = this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    if (!agent) {
      return Response.json({ error: 'Agent not found' }, { status: 404 });
    }

    if (id === requesterId) {
      return Response.json({ error: 'Cannot delete yourself' }, { status: 400 });
    }

    this.db.prepare('DELETE FROM credit_transactions WHERE agent_id = ?').run(id);
    this.db.prepare('DELETE FROM verifications WHERE agent_id = ?').run(id);
    this.db.prepare('DELETE FROM agents WHERE id = ?').run(id);

    return Response.json({ message: 'Agent deleted successfully' });
  }

  /**
   * v0.13: Delete-by-email variant of `deleteAgent`. Resolves the email to
   * an agent id and applies the same rules (cannot delete self, etc.).
   */
  deleteAgentByEmail(email: string, requesterId: string | undefined): Response {
    if (typeof email !== 'string' || !email.trim()) {
      return Response.json({ error: 'email query parameter is required' }, { status: 400 });
    }
    const agent = this.db.prepare(
      'SELECT id FROM agents WHERE email = ?'
    ).get(email.trim()) as { id: string } | undefined;
    if (!agent) {
      return Response.json({ error: `Agent not found for email: ${email}` }, { status: 404 });
    }
    // Reuse the id-based delete path so the same safeguards apply.
    // Pass undefined requesterId if caller is not authenticated; the
    // self-delete guard becomes a no-op in that case.
    return this.deleteAgent(agent.id, requesterId ?? '__no_auth__');
  }
}
