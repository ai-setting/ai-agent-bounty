import { WebSocket, WebSocketServer as WS } from 'ws';
import type { MailboxService } from './mailbox-service';
import type { Message } from './types';

interface WSMessage {
  type: string;
  data?: any;
}

export class WebSocketServer {
  private wss?: WS;
  private clients: Map<string, WebSocket> = new Map();
  private mailbox: MailboxService;
  private heartbeatInterval?: Timer;

  constructor(
    mailbox: MailboxService,
    private port = 3002,
    private heartbeatIntervalMs = 30000
  ) {
    this.mailbox = mailbox;
    // Subscribe to message events
    mailbox.onMessageSent((message) => {
      this.pushMessageToRecipient(message);
    });
  }

  async start(): Promise<void> {
    const self = this;
    const mailbox = this.mailbox;

    this.wss = new WS({ port: this.port });

    this.wss.on('connection', (ws: WebSocket, req: Request) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      const pathParts = url.pathname.split('/');
      
      // Expect /ws/agent/:agentId
      if (pathParts[1] === 'ws' && pathParts[2] === 'agent' && pathParts[3]) {
        const agentId = pathParts[3];
        self.handleConnection(ws, agentId, mailbox);
      }
    });

    // Start heartbeat checker
    this.heartbeatInterval = setInterval(() => {
      self.checkHeartbeats();
    }, this.heartbeatIntervalMs).ref();
  }

  private handleConnection(ws: WebSocket, agentId: string, mailbox: MailboxService): void {
    // Connect to mailbox
    const channel = mailbox.connect(agentId, 'websocket');
    this.clients.set(agentId, ws);

    // Handle messages
    ws.addEventListener('message', (event: any) => {
      try {
        const msg: WSMessage = JSON.parse(event.data);
        this.handleMessage(ws, agentId, msg, mailbox);
      } catch (e) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
      }
    });

    // Handle close
    ws.addEventListener('close', () => {
      this.clients.delete(agentId);
      mailbox.disconnect(agentId);
    });

    // Handle errors
    ws.addEventListener('error', () => {
      this.clients.delete(agentId);
      mailbox.disconnect(agentId);
    });

    // Send welcome
    ws.send(JSON.stringify({
      type: 'connected',
      data: { agentId, channelId: channel.id },
    }));

    // Send pending messages
    const addr = mailbox.getAddressByAgent(agentId);
    if (addr) {
      const unread = mailbox.getInbox(addr.address, { unreadOnly: true });
      unread.forEach((msg: Message) => {
        ws.send(JSON.stringify({ type: 'message.received', data: msg }));
      });
    }
  }

  private handleMessage(ws: WebSocket, agentId: string, msg: WSMessage, mailbox: MailboxService): void {
    switch (msg.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        // Update heartbeat
        const channels = mailbox.getChannels(agentId);
        const wsChannel = channels.find(c => c.type === 'websocket');
        if (wsChannel) {
          mailbox.updateHeartbeat(wsChannel.id);
        }
        break;

      case 'mark.read':
        if (msg.data?.messageId) {
          mailbox.markAsRead(msg.data.messageId);
        }
        break;

      default:
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Unknown message type' } }));
    }
  }

  private checkHeartbeats(): void {
    // Update all client heartbeats
    this.clients.forEach((ws, agentId) => {
      const channels = this.mailbox.getChannels(agentId);
      const wsChannel = channels.find(c => c.type === 'websocket');
      if (wsChannel) {
        this.mailbox.updateHeartbeat(wsChannel.id);
      }
    });
  }

  // Send message to specific agent
  sendToAgent(agentId: string, message: Message): void {
    const ws = this.clients.get(agentId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'message.received', data: message }));
    }
  }

  // Push message to recipient based on toAddress
  pushMessageToRecipient(message: Message): void {
    // Find agent by address
    const addr = this.mailbox.getAddressByEmail(message.toAddress);
    if (addr) {
      const ws = this.clients.get(addr.agentId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'message.received', data: message }));
      }
    }
  }

  stop(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }

    this.clients.forEach((ws) => {
      ws.close();
    });
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
      this.wss = undefined;
    }
  }

  getPort(): number {
    return this.port;
  }
}
