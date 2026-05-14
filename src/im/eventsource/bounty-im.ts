/**
 * Bounty IM Event Source
 * 
 * 连接 bounty IM 服务器，接收 agent 之间的消息事件
 */

import type { WebSocket as WsWebSocket } from 'ws';

// 默认配置
const DEFAULT_IM_SERVER_URL = 'ws://localhost:3001/ws';

export interface BountyIMConfig {
  id: string;
  name: string;
  type: 'bounty-im';
  address: string;           // 监听的地址 (agent-id@host)
  imServerUrl?: string;     // IM 服务器 WebSocket URL
  headers?: Record<string, string>;
}

export class BountyIMEventSource {
  private id: string;
  private config: BountyIMConfig;
  private ws: WsWebSocket | null = null;
  private status: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error' = 'created';
  private buffer: string = '';
  private onEvent?: (event: BountyIMEvent) => void;
  private onStatusChange?: (status: string) => void;

  constructor(config: BountyIMConfig) {
    this.id = config.id;
    this.config = config;
  }

  getId(): string {
    return this.id;
  }

  getStatus(): string {
    return this.status;
  }

  getConfig(): BountyIMConfig {
    return this.config;
  }

  setOnEvent(handler: (event: BountyIMEvent) => void): void {
    this.onEvent = handler;
  }

  setOnStatusChange(handler: (status: string) => void): void {
    this.onStatusChange = handler;
  }

  async start(): Promise<void> {
    if (this.status === 'running') {
      return;
    }

    this.setStatus('starting');

    const url = this.config.imServerUrl || DEFAULT_IM_SERVER_URL;
    const wsUrl = new URL(url);
    wsUrl.searchParams.set('address', this.config.address);

    console.log(`[BountyES] Connecting to ${wsUrl.toString()}`);

    try {
      const { WebSocket } = await import('ws');
      this.ws = new WebSocket(wsUrl.toString(), {
        headers: this.config.headers,
      });

      this.ws.on('open', () => {
        console.log(`[BountyES] Connected as ${this.config.address}`);
        this.setStatus('running');
      });

      this.ws.on('message', (data: Buffer | string) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error: Error) => {
        console.error(`[BountyES] WebSocket error:`, error.message);
        this.setStatus('error');
      });

      this.ws.on('close', () => {
        console.log(`[BountyES] Connection closed`);
        this.setStatus('stopped');
      });

      // 等待连接或超时
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          resolve();
        }, 5000);

        this.ws!.on('open', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.ws!.on('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });

      console.log(`[BountyES] Started listening for messages to ${this.config.address}`);
    } catch (error) {
      this.setStatus('error');
      throw new Error(`Failed to connect to Bounty IM server: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'created') {
      return;
    }

    this.setStatus('stopping');

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('stopped');
  }

  private handleMessage(data: string): void {
    this.buffer += data;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';

    for (const line of lines) {
      if (line.trim()) {
        this.processLine(line);
      }
    }
  }

  private processLine(rawData: string): void {
    try {
      let rawEvent: any;
      try {
        rawEvent = JSON.parse(rawData);
      } catch {
        rawEvent = {
          event: 'message',
          data: {
            content: { type: 'text', body: rawData },
          },
        };
      }

      const eventType = rawEvent.event 
        ? `bounty-im.${rawEvent.event}` 
        : 'bounty-im.message';

      const event: BountyIMEvent = {
        sourceId: this.id,
        type: eventType,
        timestamp: Date.now(),
        payload: {
          sourceId: this.id,
          sourceType: 'bounty-im',
          rawEvent,
          message: this.formatMessage(rawEvent),
          address: this.config.address,
        },
      };

      console.log(`[BountyES] Event: ${eventType}`);
      this.onEvent?.(event);
    } catch (err) {
      console.error(`[BountyES] Error processing line:`, err);
    }
  }

  private formatMessage(rawEvent: any): string {
    if (rawEvent.event === 'connected') {
      return `已连接到 bounty IM 服务器，地址: ${rawEvent.data?.address}`;
    }

    if (rawEvent.event === 'message' && rawEvent.data) {
      const msg = rawEvent.data;
      const from = msg.from || 'unknown';
      
      let content = '未知内容';
      if (msg.content?.type === 'text' && msg.content?.body) {
        content = msg.content.body;
      } else if (msg.content?.body) {
        content = JSON.stringify(msg.content.body);
      }

      return `[${from}] ${content}`;
    }

    return `事件: ${rawEvent.event || 'unknown'}`;
  }

  private setStatus(status: 'created' | 'starting' | 'running' | 'stopping' | 'stopped' | 'error'): void {
    this.status = status;
    this.onStatusChange?.(status);
  }
}

export interface BountyIMEvent {
  sourceId: string;
  type: string;
  timestamp: number;
  payload: {
    sourceId: string;
    sourceType: string;
    rawEvent: any;
    message: string;
    address: string;
  };
}

/**
 * Bounty IM Event Source Manager
 * 管理多个 bounty-im 事件源
 */
export class BountyIMEventSourceManager {
  private sources: Map<string, BountyIMEventSource> = new Map();
  private statuses: Map<string, string> = new Map();
  private handlers: Map<string, (event: BountyIMEvent) => void> = new Map();

  register(config: BountyIMConfig): void {
    if (this.sources.has(config.id)) {
      throw new Error(`EventSource already exists: ${config.id}`);
    }

    const source = new BountyIMEventSource(config);
    source.setOnEvent((event) => {
      const handler = this.handlers.get(config.id);
      handler?.(event);
    });
    source.setOnStatusChange((status) => {
      this.statuses.set(config.id, status);
    });

    this.sources.set(config.id, source);
    this.statuses.set(config.id, 'created');
    console.log(`[BountyES] Registered: ${config.id} (${config.type})`);
  }

  unregister(id: string): boolean {
    const source = this.sources.get(id);
    if (!source) return false;

    const status = this.statuses.get(id);
    if (status === 'running') {
      source.stop();
    }

    this.sources.delete(id);
    this.statuses.delete(id);
    this.handlers.delete(id);
    console.log(`[BountyES] Unregistered: ${id}`);
    return true;
  }

  get(id: string): BountyIMEventSource | undefined {
    return this.sources.get(id);
  }

  list(): BountyIMConfig[] {
    return Array.from(this.sources.values()).map(s => s.getConfig());
  }

  getStatus(id: string): string {
    return this.statuses.get(id) || 'unknown';
  }

  onEvent(id: string, handler: (event: BountyIMEvent) => void): void {
    this.handlers.set(id, handler);
  }

  offEvent(id: string): void {
    this.handlers.delete(id);
  }

  async start(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`EventSource not found: ${id}`);
    }
    await source.start();
  }

  async stop(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`EventSource not found: ${id}`);
    }
    await source.stop();
  }

  async stopAll(): Promise<void> {
    for (const source of this.sources.values()) {
      await source.stop();
    }
  }
}

/**
 * 验证 bounty-im 配置
 */
export function validateBountyIMConfig(config: any): string[] {
  const errors: string[] = [];

  if (!config.id) {
    errors.push('EventSource ID is required');
  }

  if (!config.name) {
    errors.push('EventSource name is required');
  }

  if (!config.address) {
    errors.push('bounty-im address is required (e.g., alice@server.com)');
  } else if (!/^[\w-]+@[\w.-]+$/.test(config.address)) {
    errors.push('bounty-im address format is invalid (expected: agent-id@host)');
  }

  if (config.imServerUrl && !config.imServerUrl.startsWith('ws://') && !config.imServerUrl.startsWith('wss://')) {
    errors.push('bounty-im imServerUrl must start with ws:// or wss://');
  }

  return errors;
}
