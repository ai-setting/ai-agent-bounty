// Content types
export type ContentType = 'text' | 'image' | 'mixed' | 'json' | 'file';

export interface TextContent {
  type: 'text';
  body: string;
}

export interface ImageContent {
  type: 'image';
  body: {
    url: string;
    thumbnailUrl?: string;
    width?: number;
    height?: number;
    size?: number;
    format?: string;
    alt?: string;
  };
}

export interface MixedContent {
  type: 'mixed';
  body: Content[];
}

export interface JsonContent {
  type: 'json';
  body: Record<string, unknown>;
}

export interface FileContent {
  type: 'file';
  body: {
    name: string;
    url: string;
    size?: number;
    format?: string;
  };
}

export type Content = TextContent | ImageContent | MixedContent | JsonContent | FileContent;

// Message
export type MessageStatus = 'pending' | 'delivered' | 'acked';

export interface Message {
  id: string;
  from: string;       // Format: agent-id@host
  to: string;         // Format: agent-id@host
  content: Content;
  status: MessageStatus;
  createdAt: string;
  deliveredAt?: string;
  ackedAt?: string;
}

// Agent
export type AgentStatus = 'online' | 'offline';

export interface Agent {
  id: string;
  host: string;
  address: string;    // Format: agent-id@host
  name?: string;
  status: AgentStatus;
  lastSeenAt: string;
  createdAt: string;
}

// API types
export interface SendMessageInput {
  to: string;
  content: Content;
}

export interface AckInput {
  messageIds: string[];
}
