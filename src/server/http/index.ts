/**
 * Bounty HTTP Server
 * 
 * Provides REST API for:
 * - Auth: /api/auth/* (public)
 * - Agents: /api/agents/* (protected)
 * - Bounty Tasks: /api/tasks/* (protected)
 * - IM Messages: /api/messages/* (protected)
 * - Legacy: /health, /messages (public)
 */

import type { IMDatabase } from '../../im/db';
import type { Database } from '../../lib/storage/database';
import { AuthRoutes } from './auth-routes.js';
import { BountyRoutes } from './bounty-routes.js';
import { IMRoutes } from './im-routes.js';
import type { Message, Content } from '../../im/types';

export interface BountyServerConfig {
  /** IM Database instance */
  imDb: IMDatabase;
  /** Bounty Database instance (optional, enables full functionality) */
  bountyDb?: Database;
  /** HTTP server port, default: 4002 */
  port?: number;
}

type PushCallback = (address: string, message: Message) => void;

export class BountyHTTPServer {
  private imDb: IMDatabase;
  private bountyDb: Database | null = null;
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private pushCallback: PushCallback | null = null;

  private authRoutes: AuthRoutes | null = null;
  private bountyRoutes: BountyRoutes | null = null;
  private imRoutes: IMRoutes | null = null;

  constructor(config: BountyServerConfig) {
    this.imDb = config.imDb;
    this.bountyDb = config.bountyDb || null;
    this.port = config.port ?? 4002;

    if (this.bountyDb) {
      this.authRoutes = new AuthRoutes(this.bountyDb);
      this.bountyRoutes = new BountyRoutes(this.bountyDb);
    }
    this.imRoutes = new IMRoutes(this.imDb, (to, msg) => this.pushCallback?.(to, msg));
  }

  setPushCallback(callback: PushCallback): void {
    this.pushCallback = callback;
    if (this.imRoutes) {
      this.imRoutes.setPushCallback(callback);
    }
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req) => this.handleRequest(req),
    });
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.server?.port ?? this.port;
  }

  private async handleRequest(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    try {
      // === Auth Routes (public) ===
      if (this.authRoutes) {
        if (method === 'POST' && path === '/api/auth/register') {
          return await this.authRoutes.register(req);
        }
        if (method === 'POST' && path === '/api/auth/verify') {
          return await this.authRoutes.verify(req);
        }
        if (method === 'POST' && path === '/api/auth/login') {
          return await this.authRoutes.login(req);
        }
        if (method === 'POST' && path === '/api/auth/send-code') {
          return await this.authRoutes.sendCode(req);
        }

        // Protected routes
        const authResult = await this.checkAuth(req);
        if (!authResult.error) {
          const agentId = authResult.agentId!;

          // Agent routes
          if (method === 'GET' && path === '/api/agents/me') {
            return this.authRoutes.getCurrentAgent(agentId);
          }
          if (method === 'GET' && path === '/api/agents/me/credits') {
            return this.authRoutes.getCurrentAgentCredits(agentId);
          }
          if (method === 'GET' && path === '/api/agents') {
            return this.authRoutes.listAgents();
          }
          if (method === 'GET' && path.startsWith('/api/agents/') && path !== '/api/agents/me') {
            const id = path.slice('/api/agents/'.length);
            return this.authRoutes.getAgentById(id);
          }
          if (method === 'DELETE' && path.startsWith('/api/agents/')) {
            const id = path.slice('/api/agents/'.length);
            return this.authRoutes.deleteAgent(id, agentId);
          }

          // Bounty routes
          if (this.bountyRoutes) {
            if (method === 'GET' && path === '/api/tasks') {
              return this.bountyRoutes.getTasks();
            }
            if (method === 'POST' && path === '/api/tasks') {
              return await this.bountyRoutes.createTask(req, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/grab')) {
              const id = path.slice('/api/tasks/'.length, -'/grab'.length);
              return this.bountyRoutes.grabTask(id, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/submit')) {
              const id = path.slice('/api/tasks/'.length, -'/submit'.length);
              return await this.bountyRoutes.submitTask(req, id, agentId);
            }
          }

          // IM routes (protected)
          if (method === 'GET' && path === '/api/messages') {
            return this.imRoutes!.getMessages(url);
          }
          if (method === 'POST' && path === '/api/messages') {
            return await this.imRoutes!.sendMessage(req);
          }
          if (method === 'GET' && path.startsWith('/api/messages/')) {
            const id = path.slice('/api/messages/'.length);
            return this.imRoutes!.getMessageById(id);
          }
          if (method === 'POST' && path === '/api/messages/ack') {
            return await this.imRoutes!.ackMessages(req);
          }
        }
      }

      // === Legacy Public Routes ===
      if (method === 'GET' && path === '/health') {
        return Response.json({ status: 'ok', timestamp: Date.now() });
      }
      if (method === 'POST' && path === '/messages') {
        return await this.imRoutes!.sendMessage(req);
      }
      if (method === 'GET' && path === '/messages') {
        return this.imRoutes!.getMessages(url);
      }
      if (method === 'GET' && path.startsWith('/messages/')) {
        const id = path.slice('/messages/'.length);
        return this.imRoutes!.getMessageById(id);
      }
      if (method === 'POST' && path === '/messages/ack') {
        return await this.imRoutes!.ackMessages(req);
      }

      return Response.json({ error: 'Not found' }, { status: 404 });
    } catch (err) {
      console.error('Request error:', err);
      return Response.json({ error: 'Internal server error' }, { status: 500 });
    }
  }

  private async checkAuth(req: Request): Promise<{ agentId?: string; error?: Response | null }> {
    const authHeader = req.headers.get('authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { error: Response.json({ error: 'Authorization header required' }, { status: 401 }) };
    }

    const token = authHeader.slice(7);

    try {
      const { verifyToken } = await import('../../auth/jwt');
      const payload = await verifyToken(token);
      return { agentId: payload.sub };
    } catch (error: any) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        return { error: Response.json({ error: 'Token expired' }, { status: 401 }) };
      }
      return { error: Response.json({ error: 'Invalid token' }, { status: 401 }) };
    }
  }
}
