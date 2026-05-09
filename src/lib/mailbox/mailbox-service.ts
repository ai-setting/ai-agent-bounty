import { AddressManager } from './address-manager';
import { MessageStore } from './message-store';
import { ChannelManager } from './channel-manager';
import { EventBus } from './event-bus';
import type { MailAddress, Message, Channel, SendMessageInput } from './types';

export class MailboxService {
  private addressManager: AddressManager;
  private messageStore: MessageStore;
  private channelManager: ChannelManager;
  private eventBus: EventBus;
  private domain: string;

  constructor(
    private db: any,
    eventBus: EventBus,
    domain = 'local'
  ) {
    this.addressManager = new AddressManager(db, domain);
    this.messageStore = new MessageStore(db);
    this.channelManager = new ChannelManager(db);
    this.eventBus = eventBus;
    this.domain = domain;
  }

  // Address operations
  registerAddress(agentId: string, name: string): MailAddress {
    return this.addressManager.register(agentId, name);
  }

  getAddressByAgent(agentId: string): MailAddress | null {
    return this.addressManager.getByAgentId(agentId);
  }

  getAddressByEmail(address: string): MailAddress | null {
    return this.addressManager.getByEmail(address);
  }

  listAddresses(): MailAddress[] {
    return this.addressManager.list();
  }

  // Message operations
  send(input: SendMessageInput): Message {
    const message = this.messageStore.send(input);
    
    this.eventBus.emit('message.sent', {
      messageId: message.id,
      fromAddress: message.fromAddress,
      toAddress: message.toAddress,
    });

    return message;
  }

  getMessage(id: string): Message | null {
    return this.messageStore.getById(id);
  }

  getInbox(address: string, options?: { unreadOnly?: boolean; limit?: number; offset?: number }): Message[] {
    return this.messageStore.getInbox(address, options);
  }

  getUnreadCount(address: string): number {
    return this.messageStore.getUnreadCount(address);
  }

  markAsRead(id: string): boolean {
    const success = this.messageStore.markAsRead(id);
    if (success) {
      this.eventBus.emit('message.read', { messageId: id });
    }
    return success;
  }

  deleteMessage(id: string): boolean {
    return this.messageStore.delete(id);
  }

  // Channel operations
  connect(agentId: string, type: 'websocket' | 'http'): Channel {
    const channel = this.channelManager.register(agentId, type);
    
    this.eventBus.emit('channel.connected', {
      agentId,
      channelId: channel.id,
    });

    return channel;
  }

  disconnect(agentId: string): void {
    const channels = this.channelManager.getByAgentId(agentId);
    channels.forEach(channel => {
      if (channel.status === 'connected') {
        this.channelManager.disconnect(channel.id);
        this.eventBus.emit('channel.disconnected', {
          agentId,
          channelId: channel.id,
        });
      }
    });
  }

  getChannels(agentId: string): Channel[] {
    return this.channelManager.getByAgentId(agentId);
  }

  updateHeartbeat(channelId: string): boolean {
    return this.channelManager.updateHeartbeat(channelId);
  }
}
