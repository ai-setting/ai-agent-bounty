import type { IMDatabase } from '../db';
import type { Message } from '../types';

interface ClientInfo {
  socket: any;
  address: string;
}

export class IMWebSocketServer {
  private clients: Map<string, ClientInfo> = new Map();
  private port: number;
  private db: IMDatabase;
  private server: any = null;

  constructor(db: IMDatabase, port: number = 3002) {
    this.db = db;
    this.port = port;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req, server) => {
        // Only upgrade WebSocket connections
        const url = new URL(req.url);
        if (url.pathname === '/ws') {
          const address = url.searchParams.get('address');
          
          if (!address) {
            return new Response(JSON.stringify({
              event: 'error',
              data: { message: 'Missing required parameter: address' }
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json' }
            });
          }

          const success = server.upgrade(req, {
            data: { address },
          } as any);

          if (success) {
            return;
          }
        }
        
        return new Response('IM WebSocket Server', { status: 200 });
      },
      websocket: {
        open: (socket) => {
          this.handleOpen(socket);
        },
        message: (socket, message) => {
          this.handleMessage(socket, message);
        },
        close: (socket) => {
          this.handleClose(socket);
        },
      },
    });

    this.port = this.server.port;
  }

  stop(): void {
    if (this.server) {
      // Close all client connections
      for (const [address, client] of this.clients) {
        client.socket.close();
        // Update agent status to offline
        this.updateAgentStatus(address, 'offline');
      }
      this.clients.clear();
      
      this.server.stop();
      this.server = null;
    }
  }

  getPort(): number {
    return this.port;
  }

  /**
   * Push message to a connected client via WebSocket
   * @returns true if the client was found and message was sent, false if client is offline
   */
  pushMessage(address: string, message: Message): boolean {
    const client = this.clients.get(address);
    if (client) {
      try {
        client.socket.send(JSON.stringify({
          event: 'message',
          data: message,
        }));
        return true;
      } catch (err) {
        console.error(`[WS] Error sending message:`, err);
      }
    }
    return false;
  }

  private handleOpen(socket: any): void {
    const address = socket.data?.address;

    if (!address) {
      socket.send(JSON.stringify({
        event: 'error',
        data: { message: 'Missing required parameter: address' },
      }));
      socket.close();
      return;
    }

    // Store client
    this.clients.set(address, { socket, address });

    // Update agent status to online
    this.updateAgentStatus(address, 'online');

    // Send pending messages (状态更新为 delivered 再发送，避免客户端收到重复)
    const pendingMessages = this.db.getPendingMessages(address);
    for (const msg of pendingMessages) {
      // 先更新状态为 delivered
      if (msg.status === 'pending') {
        this.db.updateMessageStatus(msg.id, 'delivered');
      }
      // 再发送消息（状态已是 delivered）
      socket.send(JSON.stringify({
        event: 'message',
        data: { ...msg, status: 'delivered' },
      }));
    }

    // Send connection confirmation
    socket.send(JSON.stringify({
      event: 'connected',
      data: { address },
    }));
  }

  private handleMessage(socket: any, message: any): void {
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
              this.db.updateMessageStatus(id, 'acked');
            }
          }
          break;

        case 'message':
          // 转发消息给接收者
          if (msg.data && msg.data.to) {
            const imMessage: Message = {
              id: crypto.randomUUID(),
              from: address,
              to: msg.data.to,
              content: msg.data.content || { type: 'text', body: '' },
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            
            // 保存消息到数据库
            this.db.saveMessage(imMessage);
            
            // 尝试直接推送给接收者（如果在线）
            const recipient = this.clients.get(msg.data.to);
            if (recipient) {
              recipient.socket.send(JSON.stringify({
                event: 'message',
                data: imMessage,
              }));
              // 更新状态为已送达
              this.db.updateMessageStatus(imMessage.id, 'delivered');
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

  private handleClose(socket: any): void {
    const address = socket.data?.address;
    
    if (address) {
      this.clients.delete(address);
      this.updateAgentStatus(address, 'offline');
    }
  }

  private handleError(socket: any, error: Error): void {
    const address = socket.data?.address;
    
    if (address) {
      console.error(`WebSocket error for ${address}:`, error.message);
      this.clients.delete(address);
      this.updateAgentStatus(address, 'offline');
    }
  }

  private updateAgentStatus(address: string, status: 'online' | 'offline'): void {
    // Parse address to get id and host
    const [agentId, host] = address.split('@');
    
    if (!agentId || !host) {
      return;
    }

    // Check if agent exists
    let agent = this.db.getAgentByAddress(address);

    if (!agent) {
      // Create agent record
      const now = new Date().toISOString();
      agent = {
        id: agentId,
        host,
        address,
        status,
        lastSeenAt: now,
        createdAt: now,
      };
      this.db.saveAgent(agent);
    } else {
      // Update existing agent status
      this.db.updateAgentStatus(agent.id, status);
    }
  }
}

// Alias for backward compatibility
export { IMWebSocketServer as BountyWebSocketServer };
