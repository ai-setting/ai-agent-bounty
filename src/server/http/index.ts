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
  /**
   * PR4 DI seam: 强制覆盖 BOUNTY_TOKEN_CHECK_ENABLED env。
   * - undefined: 读 env (默认 ON)
   * - true/false: 显式覆盖 env
   */
  tokenCheckEnabled?: boolean;
  /**
   * PR4 DI seam: 强制覆盖 BOUNTY_WS_AUTH_REQUIRED env。
   * - undefined: 读 env (默认 OFF)
   * - true/false: 显式覆盖 env
   */
  wsAuthRequired?: boolean;
}

/**
 * PushCallback: Push message to recipient via WebSocket
 * @returns true if recipient was found and message was pushed (online), false otherwise
 */
type PushCallback = (address: string, message: Message) => boolean;

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
  /**
   * Token check toggle (Phase 4 — 用户请求):
   * - PR4 默认 (env 未设): tokenCheckEnabled = **true** (生产安全姿态)
   * - 显式设 false: BOUNTY_TOKEN_CHECK_ENABLED=false/0 → 跳过 checkAuth
   * - 设为 true/1: BOUNTY_TOKEN_CHECK_ENABLED=true/1 → 强制 JWT 验证
   *
   * 设计动机: 部署时无需额外配置即获得最小访问控制; dev/test 场景可显式关闭。
   */
  private tokenCheckEnabled: boolean;
  /**
   * WebSocket auth feature flag (PR4):
   * - 默认 false (保守): WS upgrade 不检查 token (向后兼容)
   * - 设 BOUNTY_WS_AUTH_REQUIRED=true: WS upgrade 需 Authorization Bearer header
   *   通过 verifyToken 校验; 失败 → 拒绝 upgrade。
   */
  private wsAuthRequired: boolean = false;

  constructor(config: BountyServerConfig) {
    this.imDb = config.imDb;
    this.bountyDb = config.bountyDb || null;
    this.port = config.port ?? 4000;

    if (this.bountyDb) {
      this.authRoutes = new AuthRoutes(this.bountyDb);
      this.bountyRoutes = new BountyRoutes(this.bountyDb);
    }
    this.imRoutes = new IMRoutes(this.imDb, (to, msg) => this.pushCallback?.(to, msg) ?? false);

    // PR4: Token check defaults to ON for production safety.
    // 设为 true (env 未设 或 BOUNTY_TOKEN_CHECK_ENABLED=true/1): 强制 JWT 验证
    // 显式关闭: BOUNTY_TOKEN_CHECK_ENABLED=false/0
    //
    // 部署时无需额外配置即获得最小访问控制; dev/test 场景可显式设 false 关闭。
    if (config.tokenCheckEnabled !== undefined) {
      // DI seam 优先于 env
      this.tokenCheckEnabled = config.tokenCheckEnabled;
    } else {
      const envFlag = process.env.BOUNTY_TOKEN_CHECK_ENABLED;
      this.tokenCheckEnabled = envFlag === undefined
        ? true
        : envFlag === "true" || envFlag === "1";
    }

    // PR4: WebSocket auth is OFF by default (conservative — no breaking change).
    // Opt-in with BOUNTY_WS_AUTH_REQUIRED=true to require token at WS upgrade.
    if (config.wsAuthRequired !== undefined) {
      this.wsAuthRequired = config.wsAuthRequired;
    } else {
      const wsFlag = process.env.BOUNTY_WS_AUTH_REQUIRED;
      this.wsAuthRequired = wsFlag === "true" || wsFlag === "1";
    }
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
      // v0.13: prefer `?email=`, fall back to legacy `?address=`.
      // The WS connection identifier is the canonical `<uuid>@<host>` address.
      // When the caller supplies an email, we resolve it via the agents table.
      const emailParam = url.searchParams.get('email');
      const addressParam = url.searchParams.get('address');

      let resolvedAddress: string | null = null;
      if (addressParam && addressParam.trim()) {
        resolvedAddress = addressParam.trim();
      } else if (emailParam && emailParam.trim() && this.bountyDb) {
        // Resolve email → {id, email, address} via the shared address resolver.
        const { findAgentByEmailOrAddress } = await import(
          '../lib/address-resolver.js'
        );
        const agent = findAgentByEmailOrAddress(this.bountyDb, emailParam.trim());
        if (agent) {
          resolvedAddress = agent.address;
        }
      }

      if (!resolvedAddress) {
        return Response.json({
          event: 'error',
          data: {
            message: 'Missing required parameter: email or address (v0.13 email-first)',
          },
        }, { status: 400 });
      }

      // PR4: when wsAuthRequired is true, validate the Authorization header
      // (if present) BEFORE accepting the upgrade. Reject with 401 on missing /
      // invalid token. When wsAuthRequired is false (default), accept any
      // caller — preserving the existing dev/test behaviour.
      if (this.wsAuthRequired) {
        const authHeader = req.headers.get('authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return Response.json({
            event: 'error',
            data: { message: 'Authorization header required (BOUNTY_WS_AUTH_REQUIRED=true)' },
          }, { status: 401 });
        }
        const token = authHeader.slice(7);
        try {
          // Lazy import to avoid loading auth dep on the cold path when WS
          // auth is disabled.
          const { verifyToken } = await import('../../auth/jwt');
          await verifyToken(token);
        } catch {
          return Response.json({
            event: 'error',
            data: { message: 'Invalid token' },
          }, { status: 401 });
        }
      }

      const success = server.upgrade(req, {
        data: { address: resolvedAddress },
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

        // Protected routes - only enforce auth for /api/* paths so that
        // public legacy routes (/health, /messages) below remain reachable
        // without auth.
        //
        // Phase 4 token check toggle:
        // - tokenCheckEnabled = true (BOUNTY_TOKEN_CHECK_ENABLED=true): 走原 checkAuth 流程
        //   没 auth header → 401, bad token → 401, ok → agentId
        // - tokenCheckEnabled = false: 跳过 checkAuth, agentId 保持 undefined,
        //   但仍 dispatch routes（routes 用 body.from 当 sender）— 让 dev/test
        //   场景下所有 caller 都能访问。
        let agentId: string | undefined;
        if (path.startsWith('/api/') && this.tokenCheckEnabled) {
          const authResult = await this.checkAuth(req);
          if (authResult.error) {
            return authResult.error;
          }
          agentId = authResult.agentId;
        }
        if (agentId || !this.tokenCheckEnabled) {

          // Agent routes
          if (method === 'GET' && path === '/api/agents/me') {
            return this.authRoutes.getCurrentAgent(agentId!);
          }
          if (method === 'GET' && path === '/api/agents/me/credits') {
            return this.authRoutes.getCurrentAgentCredits(agentId!);
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
            return this.authRoutes.deleteAgent(id, agentId!);
          }

          // Bounty routes
          if (this.bountyRoutes) {
            if (method === 'GET' && path === '/api/tasks') {
              return this.bountyRoutes.getTasks(url);
            }
            if (method === 'GET' && path.startsWith('/api/tasks/') && !path.endsWith('/grab') && !path.endsWith('/submit') && !path.endsWith('/complete') && !path.endsWith('/cancel') && !path.endsWith('/dispute')) {
              const id = path.slice('/api/tasks/'.length);
              return this.bountyRoutes.getTaskById(id);
            }
            if (method === 'POST' && path === '/api/tasks') {
              return await this.bountyRoutes.createTask(req, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/grab')) {
              const id = path.slice('/api/tasks/'.length, -'/grab'.length);
              return await this.bountyRoutes.grabTask(req, id, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/submit')) {
              const id = path.slice('/api/tasks/'.length, -'/submit'.length);
              return await this.bountyRoutes.submitTask(req, id, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/complete')) {
              const id = path.slice('/api/tasks/'.length, -'/complete'.length);
              return await this.bountyRoutes.completeTask(req, id, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/cancel')) {
              const id = path.slice('/api/tasks/'.length, -'/cancel'.length);
              return await this.bountyRoutes.cancelTask(req, id, agentId);
            }
            if (method === 'PUT' && path.startsWith('/api/tasks/') && path.endsWith('/dispute')) {
              const id = path.slice('/api/tasks/'.length, -'/dispute'.length);
              return await this.bountyRoutes.disputeTask(req, id, agentId);
            }
          }

          // IM routes (protected)
          if (method === 'GET' && path === '/api/messages') {
            return this.imRoutes!.getMessages(url, { agentId: agentId! });
          }
          if (method === 'POST' && path === '/api/messages') {
            // Phase 4 hardener: only forward a requester to sendMessage when
            // we actually have an authenticated agentId. Passing
            // `{ agentId: undefined }` is semantically wrong (suggests
            // "authenticated agent with no id") and depends on the downstream
            // im-routes ternary to fall back to body.from. The cleaner
            // contract — aligned with the legacy path preserved by commit
            // 4ed7b27 — is to omit the requester arg entirely so body.from
            // is used unambiguously.
            return await this.imRoutes!.sendMessage(req, agentId ? { agentId } : undefined);
          }
          if (method === 'GET' && path.startsWith('/api/messages/')) {
            const id = path.slice('/api/messages/'.length);
            return this.imRoutes!.getMessageById(id, { agentId: agentId! });
          }
          if (method === 'POST' && path === '/api/messages/ack') {
            return await this.imRoutes!.ackMessages(req);
          }
        }
      }

      // === Legacy Public Routes ===
      // POST /messages - Send message (public legacy route)
      if (method === 'POST' && path === '/messages') {
        return await this.imRoutes!.sendMessage(req);
      }

      // GET /messages - Public legacy route (no auth, read-only by address).
      // New clients should use the protected GET /api/messages endpoint.
      if (method === 'GET' && path === '/messages') {
        return this.imRoutes!.getMessagesForAddress(url);
      }

      // GET /messages/:id - Get message by id (public legacy route)
      if (method === 'GET' && path.startsWith('/messages/')) {
        const id = path.slice('/messages/'.length);
        return this.imRoutes!.getMessageByIdPublic(id);
      }

      // POST /messages/ack - Acknowledge messages (public legacy route)
      if (method === 'POST' && path === '/messages/ack') {
        return await this.imRoutes!.ackMessages(req);
      }

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
    // Phase 4: token check toggle. 如果 BOUNTY_TOKEN_CHECK_ENABLED != true,
    // 直接返回成功 ({agentId: undefined}) — 路由层会用 body.from 当作 sender。
    if (!this.tokenCheckEnabled) {
      return { agentId: undefined };
    }

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

    // Send pending messages (状态更新为 delivered 再发送，避免客户端收到重复)
    const pendingMessages = this.imDb.getPendingMessages(address);
    for (const msg of pendingMessages) {
      // 先更新状态为 delivered
      if (msg.status === 'pending') {
        this.imDb.updateMessageStatus(msg.id, 'delivered');
      }
      // 再发送消息（状态已是 delivered），客户端收到后跳过已处理的消息
      socket.send(JSON.stringify({
        event: 'message',
        data: { ...msg, status: 'delivered' },
      }));
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
              this.imDb.updateMessageStatus(imMessage.id, 'delivered');
              recipient.socket.send(JSON.stringify({
                event: 'message',
                data: { ...imMessage, status: 'delivered' },
              }));
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

  /**
   * Push a message to a connected client via WebSocket
   * Updates message status to 'delivered' when push succeeds.
   * @returns true if the client was found and message was sent, false if client is offline
   */
  pushMessage(address: string, message: Message): boolean {
    const client = this.clients.get(address);
    if (client) {
      try {
        // Update status to delivered before sending
        if (message.status === 'pending') {
          this.imDb.updateMessageStatus(message.id, 'delivered');
        }
        client.socket.send(JSON.stringify({
          event: 'message',
          data: { ...message, status: 'delivered' },
        }));
        return true;
      } catch (err) {
        console.error('[WS] Error sending message:', err);
      }
    }
    return false;
  }
}
