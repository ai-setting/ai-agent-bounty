/**
 * Bounty WebSocket Server
 * 
 * Provides WebSocket endpoint for real-time messaging:
 * - ws://host:port/ws?address=agent@host
 */

import type { IMDatabase } from '../../im/db';
import type { Message } from '../../im/types';

interface ClientInfo {
  socket: any;
  address: string;
}

export class BountyWebSocketServer {
  private clients: Map<string, ClientInfo> = new Map();
  private port: number;
  private db: IMDatabase;
  private server: any = null;

  constructor(db: IMDatabase, port: number = 4003) {
    this.db = db;
    this.port = port;
  }

  async start(): Promise<void> {
    this.server = Bun.serve({
      port: this.port,
      fetch: (req, server) => {
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
        
        return new Response('Bounty WebSocket Server', { status: 200 });
      },
      websocket: {
        open: (socket) => this.handleOpen(socket),
        message: (socket, message) => this.handleMessage(socket, message),
        close: (socket) => this.handleClose(socket),
      },
    });

    this.port = this.server.port;
  }

  stop(): void {
    if (this.server) {
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
    return this.port;
  }

  pushMessage(address: string, message: Message): void {
    const client = this.clients.get(address);
    if (client) {
      try {
        client.socket.send(JSON.stringify({
          event: 'message',
          data: message,
        }));
      } catch (err) {
        console.error(`[WS] Error sending message:`, err);
      }
    }
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

    this.clients.set(address, { socket, address });
    this.updateAgentStatus(address, 'online');

    socket.send(JSON.stringify({
      event: 'connected',
      data: { address },
    }));

    const pendingMessages = this.db.getPendingMessages(address);
    for (const msg of pendingMessages) {
      socket.send(JSON.stringify({
        event: 'message',
        data: msg,
      }));
      if (msg.status === 'pending') {
        this.db.updateMessageStatus(msg.id, 'delivered');
      }
    }
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
          if (msg.data && msg.data.to) {
            const imMessage: Message = {
              id: crypto.randomUUID(),
              from: address,
              to: msg.data.to,
              content: msg.data.content || { type: 'text', body: '' },
              status: 'pending',
              createdAt: new Date().toISOString(),
            };
            
            this.db.saveMessage(imMessage);
            
            const recipient = this.clients.get(msg.data.to);
            if (recipient) {
              recipient.socket.send(JSON.stringify({
                event: 'message',
                data: imMessage,
              }));
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

  private updateAgentStatus(address: string, status: 'online' | 'offline'): void {
    const [agentId, host] = address.split('@');
    
    if (!agentId || !host) {
      return;
    }

    let agent = this.db.getAgentByAddress(address);

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
      this.db.saveAgent(agent);
    } else {
      this.db.updateAgentStatus(agent.id, status);
    }
  }
}
