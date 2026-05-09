# Bounty Mailbox Service Design

## Overview

Bounty Mailbox Service 是一个自建的邮件协议服务，作为 Bounty 系统的通信基础设施。它不依赖第三方邮件服务，为 Agent 间提供高效、可靠的消息传递能力。

## Design Goals

1. **自建协议**：不依赖外部 SMTP/IMAP 服务
2. **统一通信**：Agent 间通信统一入口
3. **实时推送**：WebSocket 长连接 + HTTP 轮询
4. **外部兼容**：SMTP 网关支持与外部邮件系统互通
5. **事件驱动**：消息投递、状态变更通过事件总线通知

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      Bounty Mailbox Service                      │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │   Custom     │  │   Smtp       │  │   Event              │  │
│  │   Protocol   │  │   Gateway     │  │   Bus                │  │
│  │   Server     │  │              │  │                      │  │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘  │
│         │                │                     │              │
│  ┌──────▼────────────────▼─────────────────────▼───────────┐  │
│  │                    MailboxService                        │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────────────┐ │  │
│  │  │  Address   │  │  Message   │  │  Channel            │ │  │
│  │  │  Manager   │  │  Store     │  │  Manager            │ │  │
│  │  └────────────┘  └────────────┘  └────────────────────┘ │  │
│  └──────────────────────────┬──────────────────────────────┘  │
│                             │                                   │
│  ┌─────────────────────────▼──────────────────────────────┐  │
│  │                    SQLite Database                       │  │
│  └─────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. CustomProtocolServer

自定义协议服务器，支持 WebSocket 和 HTTP 双通道。

**WebSocket Endpoint** (`/ws/agent/:agentId`)
- 长连接实时推送消息
- 心跳保活（30秒间隔）
- 自动重连机制

**HTTP Endpoint** (`/api/v1/mail/*`)
- RESTful API 风格
- 支持轮询获取消息
- 简化客户端实现

**API Routes:**

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/v1/mail/inbox` | 获取收件箱消息 |
| GET | `/api/v1/mail/inbox/:messageId` | 获取单条消息 |
| POST | `/api/v1/mail/send` | 发送消息 |
| PUT | `/api/v1/mail/read/:messageId` | 标记已读 |
| DELETE | `/api/v1/mail/:messageId` | 删除消息 |
| GET | `/api/v1/mail/addresses` | 获取地址列表 |
| POST | `/api/v1/mail/addresses` | 注册新地址 |

### 2. SmtpGateway

SMTP 网关，处理外部邮件的收发。

**Inbound SMTP** (监听 25/587 端口)
- 接收外部邮件
- 验证发件人
- 投递到本地消息存储

**Outbound SMTP** (内部队列)
- 将本地消息转发到外部邮箱
- 队列管理，重试机制
- 发送状态追踪

**Note:** 实际端口号需通过配置指定，避免权限问题。

### 3. MailboxService

核心服务，协调各组件工作。

**AddressManager**
- 注册/注销邮件地址
- 地址与 Agent 绑定
- 地址格式验证

**MessageStore**
- 消息 CRUD 操作
- 状态管理（pending → sent → delivered → read）
- 分页查询

**ChannelManager**
- WebSocket 连接管理
- 会话状态追踪
- 心跳管理

### 4. EventBus

事件总线，驱动实时通知。

**Event Types:**
- `message.received` - 新消息到达
- `message.sent` - 消息发送成功
- `message.read` - 消息已读
- `channel.connected` - 连接建立
- `channel.disconnected` - 连接断开

## Data Models

### MailAddress

```typescript
interface MailAddress {
  id: string;
  agentId: string;
  address: string;           // e.g., "alice@local"
  type: 'internal' | 'external';
  createdAt: number;
}
```

### Message

```typescript
interface Message {
  id: string;
  fromAddress: string;
  toAddress: string;
  subject?: string;
  body: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  readAt?: number;
  createdAt: number;
}
```

### Channel

```typescript
interface Channel {
  id: string;
  agentId: string;
  type: 'websocket' | 'http';
  status: 'connected' | 'disconnected';
  lastHeartbeat: number;
  createdAt: number;
}
```

## Database Schema

```sql
-- Mail addresses
CREATE TABLE mail_addresses (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  address TEXT UNIQUE NOT NULL,
  type TEXT DEFAULT 'internal',
  created_at INTEGER NOT NULL
);

-- Messages
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  read_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Channels
CREATE TABLE channels (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  last_heartbeat INTEGER,
  created_at INTEGER NOT NULL
);

-- Outbound queue (for SMTP forwarding)
CREATE TABLE outbound_queue (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  external_to TEXT NOT NULL,
  attempts INTEGER DEFAULT 0,
  next_retry_at INTEGER,
  status TEXT DEFAULT 'pending',
  error TEXT,
  created_at INTEGER NOT NULL
);
```

## Configuration

```yaml
# config.yaml
mailbox:
  domain: "local"                    # 本地邮件域
  port: 3001                         # HTTP/WebSocket 端口
  
smtp:
  enabled: true
  inbound_port: 2525                # 入站 SMTP (非 root)
  outbound_queue_interval: 5000      # 队列处理间隔 (ms)

websocket:
  heartbeat_interval: 30000         # 心跳间隔 (ms)
  max_idle_time: 120000             # 最大空闲时间 (ms)

database:
  path: "./data/mailbox.db"
```

## Implementation Phases

### Phase 1: Core Service (MVP)
1. MailboxService 核心实现
2. SQLite 数据存储
3. HTTP API 基础接口
4. 基本的消息收发功能

### Phase 2: Real-time
1. WebSocket 服务端
2. 事件总线
3. 实时消息推送
4. 心跳机制

### Phase 3: SMTP Gateway
1. SMTP 入站接收
2. 出站队列管理
3. 外部邮件转发

## Error Handling

| Scenario | Handling |
|----------|----------|
| 地址不存在 | 返回 404，提示创建地址 |
| 消息发送失败 | 状态标记 failed，记录错误 |
| WebSocket 断开 | 自动重连，补偿未读消息 |
| SMTP 投递失败 | 队列重试，最多重试 3 次 |
| 数据库错误 | 事务回滚，返回 500 |

## Security Considerations

1. **地址验证**：所有操作需验证 Agent 身份
2. **消息过滤**：防止垃圾邮件注入
3. **速率限制**：防止滥用
4. **加密传输**：WebSocket 使用 WSS，HTTP 使用 HTTPS

## Migration from Existing Implementation

现有实现 (`src/lib/mail/`, `src/lib/com/`) 将被替换：

| Old | New |
|-----|-----|
| `SmtpService` | `SmtpGateway` |
| `ImapService` | `CustomProtocolServer` (HTTP/WebSocket) |
| `MailService` | `MailboxService` |

迁移策略：
1. 保持 API 接口兼容
2. 新代码在独立模块中实现
3. 通过 Feature Flag 控制切换
4. 逐步迁移，边际验证
