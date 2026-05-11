import type { Message, Content } from '../types';

export interface MailboxConfig {
  /** Agent address, format: alice@server.com */
  address: string;
  /** HTTP Server URL, format: http://localhost:3001 */
  serverUrl: string;
  /** WebSocket URL, format: ws://localhost:3002/ws?address=xxx */
  wsUrl?: string;
  /** Auto reconnect on disconnect, default: true */
  autoReconnect?: boolean;
  /** Reconnect interval in ms, default: 3000 */
  reconnectInterval?: number;
}

type MessageHandler = (message: Message) => void;
type ConnectionHandler = () => void;
type DisconnectHandler = (reason?: string) => void;

type EventType = 'message' | 'connected' | 'disconnected';

interface WsMessage {
  event: string;
  data?: any;
}

/**
 * Mailbox Client for Agent IM
 * 
 * Connects to the IM server via WebSocket for real-time message delivery.
 * Provides HTTP fallback for sending messages and fetching inbox.
 */
export class Mailbox {
  private ws?: WebSocket;
  private config: MailboxConfig;
  private messageHandlers: Set<MessageHandler> = new Set();
  private connectionHandlers: Set<ConnectionHandler> = new Set();
  private disconnectHandlers: Set<DisconnectHandler> = new Set();
  private connected = false;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private shouldReconnect = true;

  constructor(config: MailboxConfig) {
    this.config = {
      autoReconnect: true,
      reconnectInterval: 3000,
      ...config,
    };
  }

  /**
   * Connect to the IM server via WebSocket
   */
  async connect(): Promise<boolean> {
    if (this.connected && this.ws) {
      return true;
    }

    const { address, serverUrl, wsUrl } = this.config;
    
    // Use provided wsUrl or construct from serverUrl (default path: /ws)
    let finalWsUrl: string;
    if (wsUrl) {
      // wsUrl can be just the base ws:// URL or include path
      const baseUrl = wsUrl.includes('address=') 
        ? wsUrl.slice(0, wsUrl.indexOf('?'))
        : wsUrl;
      finalWsUrl = `${baseUrl.replace(/\/+$/, '')}/ws?address=${encodeURIComponent(address)}`;
    } else {
      // Convert HTTP URL to WebSocket URL on same port
      finalWsUrl = serverUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://')
        .replace(/\/+$/, '') + `/ws?address=${encodeURIComponent(address)}`;
    }

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(finalWsUrl);

        this.ws.onopen = () => {
          this.connected = true;
          this.shouldReconnect = true;
          this.connectionHandlers.forEach(handler => handler());
          resolve(true);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

        this.ws.onclose = (event) => {
          this.connected = false;
          const reason = event.reason || `Code: ${event.code}`;
          this.disconnectHandlers.forEach(handler => handler(reason));
          
          // Auto reconnect if enabled
          if (this.config.autoReconnect && this.shouldReconnect) {
            this.scheduleReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error('[Mailbox] WebSocket error:', error);
          if (!this.connected) {
            resolve(false);
          }
        };
      } catch (err) {
        console.error('[Mailbox] Failed to connect:', err);
        resolve(false);
      }
    });
  }

  /**
   * Disconnect from the server
   */
  async disconnect(): Promise<void> {
    this.shouldReconnect = false;
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = undefined;
    }
    
    this.connected = false;
  }

  /**
   * Check if connected to the server
   */
  isConnected(): boolean {
    return this.connected && (this.ws?.readyState === WebSocket.OPEN);
  }

  /**
   * Subscribe to events
   */
  on(event: 'message', handler: MessageHandler): void;
  on(event: 'connected', handler: ConnectionHandler): void;
  on(event: 'disconnected', handler: DisconnectHandler): void;
  on(event: EventType, handler: MessageHandler | ConnectionHandler | DisconnectHandler): void {
    switch (event) {
      case 'message':
        this.messageHandlers.add(handler as MessageHandler);
        break;
      case 'connected':
        this.connectionHandlers.add(handler as ConnectionHandler);
        break;
      case 'disconnected':
        this.disconnectHandlers.add(handler as DisconnectHandler);
        break;
    }
  }

  /**
   * Unsubscribe from events
   */
  off(event: 'message', handler: MessageHandler): void;
  off(event: 'connected', handler: ConnectionHandler): void;
  off(event: 'disconnected', handler: DisconnectHandler): void;
  off(event: EventType, handler: MessageHandler | ConnectionHandler | DisconnectHandler): void {
    switch (event) {
      case 'message':
        this.messageHandlers.delete(handler as MessageHandler);
        break;
      case 'connected':
        this.connectionHandlers.delete(handler as ConnectionHandler);
        break;
      case 'disconnected':
        this.disconnectHandlers.delete(handler as DisconnectHandler);
        break;
    }
  }

  /**
   * Send a message to a recipient
   */
  async send(to: string, content: Content): Promise<Message> {
    const { serverUrl, address } = this.config;
    const url = serverUrl.replace(/\/+$/, '') + '/messages';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: address,
        to,
        content,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to send message: ${error}`);
    }

    return (await response.json()) as Message;
  }

  /**
   * Acknowledge receipt of a message
   */
  async ack(messageId: string): Promise<void> {
    await this.ackBatch([messageId]);
  }

  /**
   * Acknowledge multiple messages at once
   */
  async ackBatch(messageIds: string[]): Promise<void> {
    const { serverUrl } = this.config;
    const url = serverUrl.replace(/\/+$/, '') + '/messages/ack';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messageIds,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to ack messages: ${error}`);
    }
  }

  /**
   * Fetch messages from inbox (offline messages)
   */
  async fetchInbox(): Promise<Message[]> {
    const { serverUrl, address } = this.config;
    const url = serverUrl.replace(/\/+$/, '') + `/messages?address=${encodeURIComponent(address)}`;

    const response = await fetch(url);

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch inbox: ${error}`);
    }

    return (await response.json()) as Message[];
  }

  /**
   * Send a ping to keep the connection alive
   */
  ping(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ event: 'ping' }));
    }
  }

  private handleMessage(data: string): void {
    try {
      const msg: WsMessage = JSON.parse(data);

      switch (msg.event) {
        case 'message':
          if (msg.data) {
            this.messageHandlers.forEach(handler => handler(msg.data as Message));
          }
          break;

        case 'connected':
          this.connectionHandlers.forEach(handler => handler());
          break;

        case 'pong':
          // Ping acknowledged
          break;

        case 'error':
          console.error('[Mailbox] Server error:', msg.data?.message);
          break;

        default:
          console.warn('[Mailbox] Unknown event:', msg.event);
      }
    } catch (err) {
      console.error('[Mailbox] Failed to parse message:', err);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined;
      
      if (this.shouldReconnect && !this.connected) {
        console.log('[Mailbox] Attempting to reconnect...');
        await this.connect();
      }
    }, this.config.reconnectInterval);
  }
}
