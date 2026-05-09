export interface MailAddress {
  id: string;
  agentId: string;
  address: string;
  type: 'internal' | 'external';
  createdAt: number;
}

export interface Message {
  id: string;
  fromAddress: string;
  toAddress: string;
  subject?: string;
  body: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  readAt?: number;
  createdAt: number;
}

export interface Channel {
  id: string;
  agentId: string;
  type: 'websocket' | 'http';
  status: 'connected' | 'disconnected';
  lastHeartbeat: number;
  createdAt: number;
}

export interface OutboundQueueItem {
  id: string;
  messageId: string;
  externalTo: string;
  attempts: number;
  nextRetryAt?: number;
  status: 'pending' | 'sending' | 'failed' | 'completed';
  error?: string;
  createdAt: number;
}

export interface SendMessageInput {
  fromAddress: string;
  toAddress: string;
  subject?: string;
  body: string;
}

export interface MessageFilter {
  address?: string;
  status?: Message['status'];
  limit?: number;
  offset?: number;
}
