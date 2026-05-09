export const EventType = {
  MESSAGE_RECEIVED: 'message.received',
  MESSAGE_SENT: 'message.sent',
  MESSAGE_READ: 'message.read',
  MESSAGE_FAILED: 'message.failed',
  CHANNEL_CONNECTED: 'channel.connected',
  CHANNEL_DISCONNECTED: 'channel.disconnected',
} as const;

export type EventType = typeof EventType[keyof typeof EventType];

export type EventData = {
  'message.received': { messageId: string; fromAddress: string; toAddress: string };
  'message.sent': { messageId: string; fromAddress: string; toAddress: string };
  'message.read': { messageId: string };
  'message.failed': { messageId: string; error: string };
  'channel.connected': { agentId: string; channelId: string };
  'channel.disconnected': { agentId: string; channelId: string };
};

type Handler = (data: any) => void;

export class EventBus {
  private listeners: Map<EventType, Handler[]> = new Map();

  on<T extends EventType>(event: T, handler: (data: EventData[T]) => void): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler as Handler);
  }

  once<T extends EventType>(event: T, handler: (data: EventData[T]) => void): void {
    const wrapper = (data: EventData[T]) => {
      handler(data);
      this.off(event, wrapper as Handler);
    };
    this.on(event, wrapper as Handler);
  }

  off<T extends EventType>(event: T, handler: Handler): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit<T extends EventType>(event: T, data: EventData[T]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  static getEventTypes(): EventType[] {
    return Object.values(EventType);
  }
}
