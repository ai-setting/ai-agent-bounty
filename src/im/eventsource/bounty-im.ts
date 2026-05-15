/**
 * Bounty IM EventSource Component
 * 
 * 实现 EventSourceComponentInterface，
 * 作为事件源连接到 bounty IM 服务器
 */

// ============================================================================
// 类型定义 (拷贝 roy-agent EventSourceComponentInterface 关键定义)
// ============================================================================

export type EventSourceStatus = 
  | "created" | "starting" | "running" | "stopping" | "stopped" | "error";

export interface EventSourceConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  eventTypes?: string[];
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
  // Bounty IM 特有
  address?: string;
  imServerUrl?: string;
}

export interface EventMetadata {
  eventType?: string;
  senderId?: string;
  [key: string]: unknown;
}

export interface ReplyChannel {
  type: string;
  params?: Record<string, unknown>;
}

export interface EventSourceEventPayload {
  sourceId: string;
  sourceType: string;
  rawEvent: unknown;
  message: string;
  metadata: EventMetadata;
  replyChannel?: ReplyChannel;
  timestamp: number;
}

export interface EventSourceEvent {
  sourceId: string;
  type: string;
  timestamp: number;
  payload: EventSourceEventPayload;
}

export type EventSourceEventHandler = (event: EventSourceEvent) => string | undefined | void | Promise<void | string>;

export interface EventSourceComponentInterface {
  readonly name: string;
  readonly version: string;
  init(config?: unknown): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): unknown;
  register(config: EventSourceConfig): void;
  unregister(id: string): boolean;
  get(id: string): EventSourceConfig | undefined;
  list(): EventSourceConfig[];
  getStatus(id: string): EventSourceStatus | undefined;
  startSource(id: string): Promise<void>;
  stopSource(id: string): Promise<void>;
  onEvent(id: string, handler: EventSourceEventHandler): void;
  offEvent(id: string): void;
}

// ============================================================================
// 内部实现类
// ============================================================================

type WebSocket = import('ws').WebSocket;

class BountyIMWebSocketSource {
  private config: EventSourceConfig;
  private ws: WebSocket | null = null;
  private status: EventSourceStatus = 'created';
  private buffer: string = '';
  private onEventHandler?: (event: EventSourceEvent) => void;
  private onStatusChangeHandler?: (status: EventSourceStatus) => void;

  constructor(config: EventSourceConfig) {
    this.config = config;
  }

  getStatus(): EventSourceStatus {
    return this.status;
  }

  setOnEvent(handler: (event: EventSourceEvent) => void): void {
    this.onEventHandler = handler;
  }

  setOnStatusChange(handler: (status: EventSourceStatus) => void): void {
    this.onStatusChangeHandler = handler;
  }

  async start(): Promise<void> {
    if (this.status === 'running') return;

    this.setStatus('starting');

    const url = this.config.imServerUrl || 'ws://localhost:3001/ws';
    const wsUrl = new URL(url);
    if (this.config.address) {
      wsUrl.searchParams.set('address', this.config.address);
    }

    console.log(`[BountyIM-ES] Connecting to ${wsUrl.toString()}`);

    try {
      const { WebSocket } = await import('ws');
      this.ws = new WebSocket(wsUrl.toString(), {
        headers: this.config.headers,
      });

      this.ws.on('open', () => {
        console.log(`[BountyIM-ES] Connected as ${this.config.address}`);
        this.setStatus('running');
      });

      this.ws.on('message', (data: Buffer | string) => {
        this.handleMessage(data.toString());
      });

      this.ws.on('error', (error: Error) => {
        console.error(`[BountyIM-ES] WebSocket error:`, error.message);
        this.setStatus('error');
      });

      this.ws.on('close', () => {
        console.log(`[BountyIM-ES] Connection closed`);
        this.setStatus('stopped');
      });

      // 等待连接或超时
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        this.ws?.on('open', () => { clearTimeout(timeout); resolve(); });
        this.ws?.on('error', () => { clearTimeout(timeout); resolve(); });
      });

      console.log(`[BountyIM-ES] Started listening for messages to ${this.config.address}`);
    } catch (error) {
      this.setStatus('error');
      throw new Error(`Failed to connect to Bounty IM server: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.status === 'stopped' || this.status === 'created') return;

    this.setStatus('stopping');

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus('stopped');
  }

  private setStatus(status: EventSourceStatus): void {
    this.status = status;
    this.onStatusChangeHandler?.(status);
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
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(rawData);
      } catch {
        rawEvent = { event: 'message', data: { content: { type: 'text', body: rawData } } };
      }

      const eventType = 'bounty-im.message';
      const message = this.formatMessage(rawEvent);

      const event: EventSourceEvent = {
        sourceId: this.config.id,
        type: eventType,
        timestamp: Date.now(),
        payload: {
          sourceId: this.config.id,
          sourceType: 'bounty-im',
          rawEvent,
          message,
          metadata: this.buildMetadata(rawEvent),
          replyChannel: {
            type: 'bounty-im',
            params: {
              address: this.config.address,
              imServerUrl: this.config.imServerUrl,
            },
          },
          timestamp: Date.now(),
        },
      };

      console.log(`[BountyIM-ES] Event: ${eventType}`);
      this.onEventHandler?.(event);
    } catch (err) {
      console.error(`[BountyIM-ES] Error processing line:`, err);
    }
  }

  private formatMessage(rawEvent: unknown): string {
    const evt = rawEvent as Record<string, unknown>;
    if (evt.event === 'connected') {
      return `已连接到 bounty IM 服务器，地址: ${(evt.data as Record<string, unknown>)?.address}`;
    }
    if (evt.event === 'message') {
      const msg = (evt.data as Record<string, unknown>) || {};
      const from = (msg.from as string) || 'unknown';
      let content = '未知内容';
      if ((msg.content as Record<string, unknown>)?.type === 'text') {
        content = String((msg.content as Record<string, unknown>)?.body || '');
      }
      return `[${from}] ${content}`;
    }
    return `事件: ${evt.event || 'unknown'}`;
  }

  private buildMetadata(rawEvent: unknown): EventMetadata {
    const evt = rawEvent as Record<string, unknown>;
    const msg = (evt.data as Record<string, unknown>) || {};
    return {
      eventType: `bounty-im.${evt.event || 'message'}`,
      senderId: msg.from as string,
    };
  }
}

// ============================================================================
// 主组件类
// ============================================================================

/**
 * Bounty IM EventSource Component
 * 
 * 实现 EventSourceComponentInterface，注册为 'bounty-im' 类型事件源
 */
export class BountyIMEventSourceComponent implements EventSourceComponentInterface {
  readonly name = 'bounty-im-event-source';
  readonly version = '1.0.0';

  private sources: Map<string, BountyIMWebSocketSource> = new Map();
  private configs: Map<string, EventSourceConfig> = new Map();
  private statuses: Map<string, EventSourceStatus> = new Map();
  private handlers: Map<string, EventSourceEventHandler> = new Map();

  /**
   * 验证配置
   */
  private validateConfig(config: EventSourceConfig): string[] {
    const errors: string[] = [];

    if (!config.id) errors.push('EventSource ID is required');
    if (!config.name) errors.push('EventSource name is required');
    if (!config.address) {
      errors.push('Bounty IM address is required (format: agent-id@host)');
    } else if (!/^[\w-]+@[\w.-]+$/.test(config.address)) {
      errors.push('Bounty IM address format is invalid (expected: agent-id@host)');
    }
    if (config.imServerUrl && !config.imServerUrl.startsWith('ws://') && !config.imServerUrl.startsWith('wss://')) {
      errors.push('imServerUrl must start with ws:// or wss://');
    }

    return errors;
  }

  // ============================================================
  // EventSourceComponentInterface 实现
  // ============================================================

  async init(_config?: unknown): Promise<void> {
    console.log('[BountyIM-ES] Component initialized');
  }

  async start(): Promise<void> {
    console.log('[BountyIM-ES] Component started');
  }

  async stop(): Promise<void> {
    for (const source of this.sources.values()) {
      await source.stop();
    }
    console.log('[BountyIM-ES] Component stopped');
  }

  getStatus(): unknown {
    const summary: Record<string, EventSourceStatus> = {};
    for (const [id, status] of this.statuses) {
      summary[id] = status;
    }
    return summary;
  }

  register(config: EventSourceConfig): void {
    const errors = this.validateConfig(config);
    if (errors.length > 0) {
      throw new Error(`Invalid config: ${errors.join(', ')}`);
    }

    if (this.sources.has(config.id)) {
      throw new Error(`EventSource already exists: ${config.id}`);
    }

    const source = new BountyIMWebSocketSource(config);
    source.setOnEvent((event) => {
      const handler = this.handlers.get(config.id);
      handler?.(event);
    });
    source.setOnStatusChange((status) => {
      this.statuses.set(config.id, status);
    });

    this.sources.set(config.id, source);
    this.configs.set(config.id, config);
    this.statuses.set(config.id, 'created');

    console.log(`[BountyIM-ES] Registered: ${config.id} (${config.type})`);
  }

  unregister(id: string): boolean {
    const source = this.sources.get(id);
    if (!source) return false;

    const status = this.statuses.get(id);
    if (status === 'running') {
      source.stop();
    }

    this.sources.delete(id);
    this.configs.delete(id);
    this.statuses.delete(id);
    this.handlers.delete(id);

    console.log(`[BountyIM-ES] Unregistered: ${id}`);
    return true;
  }

  get(id: string): EventSourceConfig | undefined {
    return this.configs.get(id);
  }

  list(): EventSourceConfig[] {
    return Array.from(this.configs.values());
  }

  getStatus(id: string): EventSourceStatus | undefined {
    return this.statuses.get(id);
  }

  async startSource(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`EventSource not found: ${id}`);
    }
    await source.start();
  }

  async stopSource(id: string): Promise<void> {
    const source = this.sources.get(id);
    if (!source) {
      throw new Error(`EventSource not found: ${id}`);
    }
    await source.stop();
  }

  onEvent(id: string, handler: EventSourceEventHandler): void {
    this.handlers.set(id, handler);
  }

  offEvent(id: string): void {
    this.handlers.delete(id);
  }
}

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 创建 bounty-im 事件源配置
 */
export function createBountyIMConfig(options: {
  name: string;
  address: string;
  imServerUrl?: string;
  eventTypes?: string[];
}): EventSourceConfig {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);

  return {
    id: `bounty-im_${timestamp}_${random}`,
    name: options.name,
    type: 'bounty-im',
    enabled: true,
    address: options.address,
    imServerUrl: options.imServerUrl || 'ws://localhost:3001/ws',
    eventTypes: options.eventTypes,
  };
}

/**
 * 验证 bounty-im 配置
 */
export function validateBountyIMConfig(config: unknown): string[] {
  if (typeof config !== 'object' || config === null) {
    return ['Config must be an object'];
  }

  const c = config as Record<string, unknown>;
  const errors: string[] = [];

  if (!c.id) errors.push('EventSource ID is required');
  if (!c.name) errors.push('EventSource name is required');
  if (!c.address) errors.push('Bounty IM address is required');

  return errors;
}

// 导出单例供外部使用
export const bountyIMEventSourceComponent = new BountyIMEventSourceComponent();
