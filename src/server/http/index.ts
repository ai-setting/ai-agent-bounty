/**
 * Bounty HTTP Server with WebSocket Support
 * 
 * Bun.serve natively supports both HTTP and WebSocket on the same port.
 * 
 * Provides REST API for:
 * - Auth: /api/auth/* (public)
 * - Agents: /api/agents/* (protected)
 * - Bounty Tasks: /api/tasks/* (protected)
 * - IM Messages: /api/messages/* (protected)
 * - Legacy: /health, /messages (public)
 * 
 * WebSocket endpoint: ws://host:port/ws?address=agent@host
 */

import type { IMDatabase } from '../../im/db';
import type { Database } from '../../lib/storage/database';
import type { Message } from '../../im/types';
import { AuthRoutes } from './auth-routes.js';
import { BountyRoutes } from './bounty-routes.js';
import { IMRoutes } from './im-routes.js';

export interface BountyServerConfig {
  /** IM Database instance */
  imDb: IMDatabase;
  /** Bounty Database instance (optional, enables full functionality) */
  bountyDb?: Database;
  /** Server port, default: 4000 */
  port?: number;
}

type PushCallback = (address: string, message: Message) => void;

interface ClientInfo {
  socket: any;
  address: string;
}

export class BountyHTTPServer {
  private imDb: IMDatabase;
  private bountyDb: Database | null = null;
  private port: number;
  private server: ReturnType<typeof Bun.serve> | null = null;
  private clients: Map<string, ClientInfo> = new Map();
  private pushCallback: PushCallback | null = null;

  private authRoutes: AuthRoutes | null = null;
  private bountyRoutes: BountyRoutes | null = null;
  private imRoutes: IMRoutes | null = null;

  constructor(config: BountyServerConfig) {
    this.imDb = config.imDb;
    this.bountyDb = config.bountyDb || null;
    this.port = config.port ?? 4000;

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

  start(): void {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req, server) => this.handleRequest(req, server),
      websocket: {
        open: (socket) => this.handleWsOpen(socket),
        message: (socket, message) => this.handleWsMessage(socket, message),
        close: (socket) => this.handleWsClose(socket),
      },
    });
    console.log(`   HTTP/WS: ws://localhost:${this.port}/ws`);
  }

  stop(): void {
    if (this.server) {
      // Close all WebSocket connections
      for (const [address, client] of this.clients) {
        client.socket.close();
        this.updateAgentStatus(address, 'offline');
      }
      this.clients.clear();
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.server?.port ?? this.port;
  }

  // ============ HTTP Handler ============

  private async handleRequest(req: Request, server: any): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;

    // Handle WebSocket upgrade for /ws endpoint
    if (path === '/ws') {
      const address = url.searchParams.get('address');
      
      if (!address) {
        return Response.json({
          event: 'error',
          data: { message: 'Missing required parameter: address' }
        }, { status: 400 });
      }

      const success = server.upgrade(req, {
        data: { address },
      });

      if (success) {
        return new Response(undefined);  // WebSocket upgraded, no HTTP response
      }
    }

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
      if (method === 'POST' && path === '/api/shutdown') {
        // Graceful shutdown endpoint
        this.stop();
        return Response.json({ status: 'shutdown' });
      }
      if (method === 'GET' && path === '/') {
        return Response.json({ 
          service: 'Bounty Server',
          version: '1.0.0',
          endpoints: {
            http: `http://localhost:${this.port}`,
            websocket: `ws://localhost:${this.port}/ws`,
            health: `http://localhost:${this.port}/health`
          }
        });
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

  // ============ WebSocket Handlers ============

  private handleWsOpen(socket: any): void {
    const address = socket.data?.address;

    if (!address) {
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: 'Missing required parameter: address' },
      }));
      socket.close();
      return;
    }

    this.clients.set(address, { socket, address });
    this.updateAgentStatus(address, 'online');

    socket.send(JSON.stringify({
      event: 'connected',
      data: { address },
    }));

    // Send pending messages
    const pendingMessages = this.imDb.getPendingMessages(address);
    for (const msg of pendingMessages) {
      socket.send(JSON.stringify({
        event: 'message',
        data: msg,
      }));
      if (msg.status === 'pending') {
        this.imDb.updateMessageStatus(msg.id, 'delivered');
      }
    }
  }

  private handleWsMessage(socket: any, message: any): void {
    const address = socket.data?.address;
    
    if (!address) {
      return;
    }

    try {
      const msg = typeof message === 'string' ? JSON.parse(message) : message;
      
      switch (msg.event) {
        case 'ping':
          socket.send(JSON.stringify({ event: 'pong' }));
          break;

        case 'ack':
          if (msg.data && Array.isArray(msg.data.messageIds)) {
            for (const id of msg.data.messageIds) {
              this.imDb.updateMessageStatus(id, 'acked');
            }
          }
          break;

        case 'message':
          if (msg.data && msg.data.to) {
            const imMessage: Message = {
              id: crypto.randomUUID(),
              from: address,
              to: msg.data.to,
              content: msg.data.content || { type: 'text', body: '' },
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            
            this.imDb.saveMessage(imMessage);
            
            // Send to recipient if online
            const recipient = this.clients.get(msg.data.to);
            if (recipient) {
              recipient.socket.send(JSON.stringify({
                event: 'message',
                data: imMessage,
              }));
              this.imDb.updateMessageStatus(imMessage.id, 'delivered');
            }
          }
          break;

        default:
          socket.send(JSON.stringify({
            event: 'error',
            data: { message: `Unknown event: ${msg.event}` },
          }));
      }
    } catch (err) {
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: 'Invalid JSON message' },
      }));
    }
  }

  private handleWsClose(socket: any): void {
    const address = socket.data?.address;
    
    if (address) {
      this.clients.delete(address);
      this.updateAgentStatus(address, 'offline');
    }
  }

  private updateAgentStatus(address: string, status: 'online' | 'offline'): void {
    const [agentId, host] = address.split('@');
    
    if (!agentId || !host) {
      return;
    }

    let agent = this.imDb.getAgentByAddress(address);

    if (!agent) {
      const now = new Date().toISOString();
      agent = {
        id: agentId,
        host,
        address,
        status,
        lastSeenAt: now,
        createdAt: now,
      };
      this.imDb.saveAgent(agent);
    } else {
      this.imDb.updateAgentStatus(agent.id, status);
    }
  }

  // ============ Exported for Server Entry ============

  pushMessage(address: string, message: Message): void {
    const client = this.clients.get(address);
    if (client) {
      try {
        client.socket.send(JSON.stringify({
          event: 'message',
          data: message,
        }));
      } catch (err) {
        console.error('[WS] Error sending message:', err);
      }
    }
  }
}
