/**
 * Bounty IM EventSource Handler
 * 
 * 实现 EventSourceHandler 接口，通过 EventSourceInitHooks 注册到 roy-agent
 * 使用 bountyConfig 统一管理配置
 */

import {
  EventSourceInitHooks,
  type EventSourceHandler,
  type EventSourceInstance,
  type EventSourceConfig,
  type EventSourceEvent,
  type EventSourceEventHandler,
  type EventSourceStatus,
  type EventMetadata,
  type ReplyChannel,
  type RecommendedAction,
} from "@ai-setting/roy-agent-core";

import { bountyConfig } from '../../lib/config/bounty-config.js';

// 导入全局 env 实例获取函数（由 bounty cli 提供）
// 注意：这里通过动态导入避免循环依赖
async function getGlobalEnv(): Promise<any> {
  try {
    const { getGlobalEnv } = await import('../../cli/cli.js');
    return getGlobalEnv();
  } catch {
    return null;
  }
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

  /**
   * 获取当前配置的地址
   * 优先使用 config.options.address，如果为空则从 bountyConfig 获取
   */
  private getCurrentAddress(): string {
    return (this.config.options?.address as string) || bountyConfig.imAddress || "unknown";
  }

  getStatus(): EventSourceStatus {
    return this.status;
  }

  async start(): Promise<void> {
    if (this.status === "running") return;

    this.setStatus("starting");

    // 使用 bountyConfig 统一获取 IM Server URL
    const address = this.config.options?.address as string | undefined;
    const imServerUrl = (this.config.options?.imServerUrl as string) || bountyConfig.getImServerUrl();
    
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

      // 跳过非消息事件（如 connected、pong 等）
      if (evt.event !== "message") {
        return;
      }

      // 只处理 pending 状态的消息（由其他 agent 发送的新消息）
      // 跳过 delivered 状态的消息（WS 连接时发送的历史消息，已通过 handleOpen 推送过）
      if (msg.status && msg.status !== "pending") {
        return;
      }

      const eventType = `bounty-im.${evt.event || "message"}`;

      // 提取消息关键信息
      const fromAddress = msg.from as string || "unknown";
      const currentAddress = this.getCurrentAddress();
      const toAddress = msg.to as string || currentAddress;
      
      // 如果 toAddress 不是当前配置的地址，说明有问题
      if (msg.to && msg.to !== currentAddress) {
        console.warn(`[BountyIM] Warning: message.to (${msg.to}) !== current address (${currentAddress})`);
      }
      
      const msgContent = msg.content as Record<string, unknown>;
      const content = msgContent?.type === "text" ? String(msgContent.body || "") : "";

      // 构建 metadata（参考 lark-cli 实现）
      const metadata: EventMetadata = {
        eventType,
        senderId: fromAddress,
        chatId: toAddress,  // 当前 agent 的地址作为 chatId
      };

      // 推荐动作：告诉 Agent 如何回复（参考 lark-cli recommendedAction）
      let recommendedAction: RecommendedAction | undefined;
      if (evt.event === "message") {
        recommendedAction = {
          action: `处理消息并通过 bounty com send 回复发件人。使用格式：bounty com send -f ${toAddress} -t ${fromAddress} -b "回复内容"`,
          replyTo: {
            chatId: fromAddress,  // 回复目标：发件人
          },
        };
      }

      // 反馈通道：包含回复所需的信息
      const replyChannel: ReplyChannel = {
        type: "bounty-im",
        chatId: fromAddress,  // 回复目标：发件人
        params: {
          from: toAddress,  // 当前 agent 地址作为发件人
          to: fromAddress,  // 回复给发件人
          imServerUrl: this.config.options?.imServerUrl,
        },
      };

      // 构建用户可见的消息（包含 recommendedAction 提示）
      // 格式：显示发件人、消息内容，然后提供回复命令提示
      const displayMessage = content
        ? `[From ${fromAddress}] ${content}\n\n💡 回复: bounty com send -f ${toAddress} -t ${fromAddress} -b "回复内容"`
        : this.formatMessage(rawEvent);

      const event: EventSourceEvent = {
        sourceId: this.config.id,
        type: eventType,
        timestamp: Date.now(),
        payload: {
          sourceId: this.config.id,
          sourceType: "bounty-im",
          from: fromAddress,  // 消息发件人地址
          rawEvent,
          message: displayMessage,  // 使用包含回复提示的消息
          metadata,
          recommendedAction,
          replyChannel,
          timestamp: Date.now(),
        },
      };

      // 调用 EventSourceEventHandler（供其他组件使用）
      this.eventHandler?.(event);

      // 推送 EnvEvent 到环境事件系统（event-source 类型，匹配 interactive 监听）
      this.pushEnvEvent(event);

      // 处理完成后发送 ACK 到 IM 服务器，更新消息状态为 acked
      // 防止消息因状态停留在 pending/delivered 而被重复投递或处理
      if (msg.id && this.ws) {
        try {
          const ackPayload = JSON.stringify({
            event: 'ack',
            data: { messageIds: [msg.id] },
          });
          this.ws.send(ackPayload);
          console.log(`[BountyIM] 已发送 ACK for message: ${msg.id}`);
        } catch (ackErr) {
          console.error(`[BountyIM] 发送 ACK 失败:`, ackErr);
        }
      }
    } catch (err) {
      console.error(`[BountyIM] Error processing message:`, err);
    }
  }

  /**
   * 推送 EnvEvent 到环境事件系统
   * 使用 event-source.event 类型前缀，匹配 interactive 的监听
   */
  private async pushEnvEvent(event: EventSourceEvent): Promise<void> {
    const env = await getGlobalEnv();
    if (!env) {
      console.log(`[BountyIM] 全局 env 未设置，无法推送 EnvEvent`);
      return;
    }

    if (typeof env.pushEnvEvent !== "function") {
      console.log(`[BountyIM] env.pushEnvEvent 不存在`);
      return;
    }

    // 推送事件到 EnvEvent 系统（event-source.event 前缀匹配 interactive 监听）
    env.pushEnvEvent({
      type: `event-source.event.${event.type}`,
      payload: event.payload,
    });
    console.log(`[BountyIM] 已推送 EnvEvent: event-source.event.${event.type}`);
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

    // 使用 bountyConfig 获取地址和 IM Server URL
    const address = (config.options?.address as string) || bountyConfig.imAddress;
    if (!address) {
      errors.push("Bounty IM address is required (options.address or BOUNTY_IM_ADDRESS env)");
    } else if (!/^[\w-]+@[\w.-]+$/.test(address)) {
      errors.push("Address format invalid (expected: agent-id@host)");
    }

    const imServerUrl = (config.options?.imServerUrl as string) || bountyConfig.getImServerUrl();
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
