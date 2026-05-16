/**
 * Bounty IM EventSource Handler
 * 
 * 实现 EventSourceHandler 接口，通过 EventSourceInitHooks 注册到 roy-agent
 * 支持环境变量配置：BOUNTY_IM_ADDRESS, BOUNTY_IM_SERVER_URL
 */

import {
  EventSourceInitHooks,
  type EventSourceHandler,
  type EventSourceInstance,
  type EventSourceConfig,
  type EventSourceEvent,
  type EventSourceEventHandler,
  type EventSourceStatus,
} from "@ai-setting/roy-agent-core";

// ============================================================================
// 环境变量配置
// ============================================================================

interface BountyIMEnvConfig {
  address?: string;
  imServerUrl?: string;
}

/**
 * 从环境变量读取 Bounty IM 配置
 */
function getEnvConfig(): BountyIMEnvConfig {
  return {
    address: process.env.BOUNTY_IM_ADDRESS,
    imServerUrl: process.env.BOUNTY_IM_SERVER_URL,
  };
}

// ============================================================================
// BountyIMInstance - 实现 EventSourceInstance 接口
// ============================================================================

type WebSocket = import('ws').WebSocket;

export class BountyIMInstance implements EventSourceInstance {
  private config: EventSourceConfig;
  private status: EventSourceStatus = "created";
  private ws: WebSocket | null = null;
  private buffer: string = "";
  private eventHandler?: EventSourceEventHandler;

  constructor(config: EventSourceConfig) {
    this.config = config;
  }

  getStatus(): EventSourceStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status === "running") return;

    this.setStatus("starting");

    const address = this.config.options?.address as string | undefined;
    const imServerUrl = (this.config.options?.imServerUrl as string) || "ws://localhost:3001/ws";
    
    const wsUrl = new URL(imServerUrl);
    if (address) {
      wsUrl.searchParams.set("address", address);
    }

    console.log(`[BountyIM] Connecting to ${wsUrl.toString()}...`);

    try {
      const { WebSocket } = await import("ws");
      this.ws = new WebSocket(wsUrl.toString(), {
        headers: this.config.headers,
      });

      this.ws.on("open", () => {
        console.log(`[BountyIM] Connected${address ? ` as ${address}` : ""}`);
        this.setStatus("running");
      });

      this.ws.on("message", (data: Buffer | string) => {
        this.handleMessage(data.toString());
      });

      this.ws.on("error", (error: Error) => {
        console.error(`[BountyIM] Error:`, error.message);
        this.setStatus("error");
      });

      this.ws.on("close", () => {
        console.log(`[BountyIM] Connection closed`);
        this.setStatus("stopped");
      });

      // 等待连接或超时
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 5000);
        this.ws?.on("open", () => {
          clearTimeout(timeout);
          resolve();
        });
        this.ws?.on("error", () => {
          clearTimeout(timeout);
          resolve();
        });
      });

    } catch (error) {
      this.setStatus("error");
      throw new Error(`Failed to connect to Bounty IM server: ${error}`);
    }
  }

  async stop(): Promise<void> {
    if (this.status === "stopped" || this.status === "created") return;

    this.setStatus("stopping");

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.setStatus("stopped");
  }

  onEvent(handler: EventSourceEventHandler): void {
    this.eventHandler = handler;
  }

  offEvent(): void {
    this.eventHandler = undefined;
  }

  private setStatus(status: EventSourceStatus): void {
    this.status = status;
  }

  private handleMessage(data: string): void {
    this.buffer += data;

    // Try to parse as complete JSON
    try {
      JSON.parse(this.buffer);
      // Complete JSON, process it
      this.processLine(this.buffer);
      this.buffer = "";
    } catch {
      // Not complete JSON yet, wait for more data
    }
  }

  private processLine(rawData: string): void {
    try {
      let rawEvent: unknown;
      try {
        rawEvent = JSON.parse(rawData);
      } catch {
        rawEvent = {
          event: "message",
          data: { content: { type: "text", body: rawData } },
        };
      }

      const evt = rawEvent as Record<string, unknown>;
      const msg = (evt.data as Record<string, unknown>) || {};
      const eventType = `bounty-im.${evt.event || "message"}`;

      const event: EventSourceEvent = {
        sourceId: this.config.id,
        type: eventType,
        timestamp: Date.now(),
        payload: {
          sourceId: this.config.id,
          sourceType: "bounty-im",
          rawEvent,
          message: this.formatMessage(rawEvent),
          metadata: {
            eventType,
            senderId: msg.from as string,
          },
          replyChannel: {
            type: "bounty-im",
            params: {
              address: this.config.options?.address,
              imServerUrl: this.config.options?.imServerUrl,
            },
          },
          timestamp: Date.now(),
        },
      };

      this.eventHandler?.(event);
    } catch (err) {
      console.error(`[BountyIM] Error processing message:`, err);
    }
  }

  private formatMessage(rawEvent: unknown): string {
    const evt = rawEvent as Record<string, unknown>;
    if (evt.event === "connected") {
      return `✅ 已连接到 bounty IM 服务器`;
    }
    if (evt.event === "message") {
      const msg = (evt.data as Record<string, unknown>) || {};
      const from = (msg.from as string) || "unknown";
      let content = "未知内容";
      if ((msg.content as Record<string, unknown>)?.type === "text") {
        content = String((msg.content as Record<string, unknown>)?.body || "");
      }
      return `[${from}] ${content}`;
    }
    return `事件: ${evt.event || "unknown"}`;
  }
}

// ============================================================================
// BountyIMHandler - 实现 EventSourceHandler 接口
// ============================================================================

export const bountyIMHandler: EventSourceHandler = {
  type: "bounty-im",

  validateConfig(config: EventSourceConfig): string[] {
    const errors: string[] = [];

    if (!config.id) errors.push("EventSource ID is required");
    if (!config.name) errors.push("EventSource name is required");

    const address = (config.options?.address as string) || getEnvConfig().address;
    if (!address) {
      errors.push("Bounty IM address is required (options.address or BOUNTY_IM_ADDRESS env)");
    } else if (!/^[\w-]+@[\w.-]+$/.test(address)) {
      errors.push("Address format invalid (expected: agent-id@host)");
    }

    const imServerUrl = (config.options?.imServerUrl as string) || getEnvConfig().imServerUrl;
    if (imServerUrl && !imServerUrl.startsWith("ws://") && !imServerUrl.startsWith("wss://")) {
      errors.push("imServerUrl must start with ws:// or wss://");
    }

    return errors;
  },

  createInstance(config: EventSourceConfig): EventSourceInstance {
    return new BountyIMInstance(config);
  },
};

// ============================================================================
// 自动注册
// ============================================================================

EventSourceInitHooks.register("bounty-im", async (component) => {
  component.registerHandler(bountyIMHandler);
  console.log("[BountyIM] Handler registered to EventSourceComponent");
});

// 导出
export type { BountyIMEnvConfig };
