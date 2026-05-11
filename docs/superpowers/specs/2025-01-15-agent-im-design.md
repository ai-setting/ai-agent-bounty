# Agent IM 设计文档

> 日期：2025-01-15  
> 状态：已批准

## 1. 概述

### 1.1 目标

实现一个类似 IM 的 Agent 通信系统，让 Agent 可以像人用微信一样简单地进行消息传递。

### 1.2 核心特性

- **星状拓扑**：中心消息服务器 + 去中心化地址发现
- **At-Least-Once**：消息至少送达一次
- **离线支持**：消息持久化，上线后拉取
- **简单协议**：JSON 消息，HTTP + WebSocket
- **实时推送**：WebSocket 长连接

---

## 2. 需求总结

| 维度 | 决策 |
|------|------|
| 架构 | 星状拓扑 + 中心消息服务器 |
| 地址发现 | 去中心化，地址可分享（微信号模式） |
| 可靠性 | At-Least-Once |
| 消息语义 | 简单发送/接收，fire-and-forget |
| 运行模式 | 持久运行主 agent + 临时子 agent |
| 离线支持 | 消息持久化，上线后拉取 |
| 消息处理 | 读取即消费，但保留历史 |
| 消息格式 | JSON |

---

## 3. 架构

```
┌─────────────────────────────────────────────────────────────┐
│                    中心消息服务器                             │
│                                                             │
│  POST /messages     ← 发送消息                               │
│  GET  /messages    ← 拉取离线消息                           │
│  WebSocket /ws     ← 实时推送                               │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐    │
│  │  SQLite: messages, agents                           │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
                            ▲
        ┌───────────────────┼───────────────────┐
        │                   │                   │
   ┌────┴────┐         ┌────┴────┐         ┌────┴────┐
   │ Agent A │         │ Agent B │         │ Agent C │
   └─────────┘         └─────────┘         └─────────┘
```

---

## 4. 地址格式

### 4.1 地址格式

Agent 地址采用 Email 格式：`agent-id@host`

### 4.2 地址示例

| Agent | 地址 |
|-------|------|
| 用户 A 的 agent | `alice@server-1.example.com` |
| 用户 B 的 agent | `bob@server-1.example.com` |
| 另一个服务器上的 agent | `carol@server-2.example.com` |

---

## 5. API 规范

### 5.1 HTTP API

| 方法 | 路径 | 描述 |
|------|------|------|
| `POST` | `/messages` | 发送消息 |
| `GET` | `/messages` | 拉取离线消息 |
| `GET` | `/messages/{id}` | 获取单条消息 |
| `POST` | `/messages/ack` | 批量确认消息已读 |
| `GET` | `/agents/{address}` | 获取 agent 信息 |
| `POST` | `/agents` | 注册 agent |
| `GET` | `/health` | 健康检查 |

### 5.2 WebSocket API

| 事件 | 方向 | 描述 |
|------|------|------|
| `connect` | Client → Server | 连接并认证 |
| `message` | Server → Client | 收到新消息 |
| `ack` | Client → Server | 确认消息已读 |

---

## 6. 数据模型

### 6.1 Message

```typescript
interface Message {
  id: string;           // UUID
  from: string;         // 发送者地址，格式: agent-id@host
  to: string;           // 接收者地址，格式: agent-id@host
  content: Content;     // 消息内容
  status: 'pending' | 'delivered' | 'acked';
  createdAt: string;    // ISO 时间戳
  deliveredAt?: string; // 送达时间
  ackedAt?: string;    // 确认时间
}

interface Content {
  type: 'text' | 'image' | 'mixed' | 'json' | 'file';
  body: TextBody | ImageBody | MixedBody | JsonBody | FileBody;
}

interface TextBody {
  body: string;
}

interface ImageBody {
  url: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  size?: number;
  format?: string;
  alt?: string;
}

interface MixedBody {
  body: Content[];
}

interface JsonBody {
  body: Record<string, unknown>;
}

interface FileBody {
  name: string;
  url: string;
  size?: number;
  format?: string;
}
```

### 6.2 Agent

```typescript
interface Agent {
  id: string;           // agent-id (地址前缀)
  host: string;        // 服务器地址 (host:port)
  address: string;     // 完整地址: agent-id@host
  name?: string;       // 显示名
  status: 'online' | 'offline';
  lastSeenAt: string;  // 最后活跃时间
  createdAt: string;
}
```

---

## 7. 消息流程

### 7.1 在线消息流程

```
Agent A                    Server                    Agent B
   │                          │                          │
   │──── POST /messages ────→│                          │
   │     {to: "bob@host"}    │                          │
   │                          │                          │
   │                          │──── WS: message ────────→│
   │                          │     {from: "alice@host"}│
   │                          │                          │
   │                          │←─── WS: ack ─────────────│
   │                          │     {messageId: "xxx"}   │
   │                          │                          │
   │←─── 200 OK ──────────────│                          │
```

### 7.2 离线消息流程

```
Agent A                    Server                    Agent B
   │                          │                          │
   │──── POST /messages ────→│                          │(离线)
   │     {to: "bob@host"}    │                          │
   │                          │──── 保存到 SQLite ───────│
   │                          │                          │
   │←─── 200 OK ──────────────│                          │
   │                          │                          │
   │                          │         (Agent B 上线)   │
   │                          │←─── WS: connect ────────│
   │                          │                          │
   │                          │←─── GET /messages ───────│
   │                          │     (拉取离线消息)       │
   │                          │                          │
   │                          │──── 批量返回消息 ───────→│
   │                          │                          │
   │                          │←─── POST ack (批量) ─────│
```

---

## 8. At-Least-Once 实现

### 8.1 消息状态机

```
                    ┌──────────────┐
                    │   pending    │  (消息创建)
                    └──────┬───────┘
                           │ 服务器接收
                           ▼
                    ┌──────────────┐
            ┌───────│  delivered   │  (推送给接收方)
            │       └──────┬───────┘
            │              │ 接收方 ACK
            ▼              ▼
     ┌──────────────┐     │
     │   acked      │←────┘
     └──────────────┘
```

### 8.2 可靠性保证

| 场景 | 处理方式 |
|------|----------|
| 消息发送后网络断开 | 重试 POST，直到收到 200 |
| 接收方网络断开 | 消息持久化，WebSocket 重连后自动推送 |
| 接收方处理失败 | 不 ACK，消息保留，WebSocket 重连后重新推送 |
| 超时未 ACK | 服务器定期清理 `delivered` 状态超过 X 分钟的消息 |

---

## 9. 错误处理

### 9.1 错误响应格式

```json
{
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent 'bob@server.example.com' not found",
    "details": {}
  }
}
```

### 9.2 错误码

| 错误码 | HTTP 状态 | 描述 |
|--------|-----------|------|
| `INVALID_REQUEST` | 400 | 请求格式错误 |
| `AGENT_NOT_FOUND` | 404 | Agent 不存在 |
| `MESSAGE_NOT_FOUND` | 404 | 消息不存在 |
| `INTERNAL_ERROR` | 500 | 服务器内部错误 |
| `RATE_LIMITED` | 429 | 请求过于频繁 |

---

## 10. 客户端 SDK 使用示例

```typescript
import { Mailbox } from '@ai-agent-bounty/mailbox';

// 创建 mailbox
const mailbox = new Mailbox({
  address: 'alice@server.example.com',
  server: 'wss://server.example.com/ws'
});

// 监听消息
mailbox.on('message', async (msg) => {
  console.log(`收到消息 from ${msg.from}:`, msg.content);
  
  // 处理完成后 ACK
  await mailbox.ack(msg.id);
});

// 发送文本消息
await mailbox.send('bob@server.example.com', {
  type: 'text',
  body: '你好 Bob！'
});

// 发送图片
await mailbox.send('bob@server.example.com', {
  type: 'image',
  body: {
    url: 'https://storage.example.com/photo.jpg',
    width: 1920,
    height: 1080,
    format: 'jpeg'
  }
});

// 启动
await mailbox.connect();
console.log('Mailbox 已连接:', mailbox.address);
```

---

## 11. 服务器配置

```yaml
# config.yaml
server:
  host: "0.0.0.0"
  port: 3000
  wsPath: "/ws"

database:
  path: "./data/messages.db"  # SQLite 文件路径

auth:
  enabled: false  # 初期简化，暂不做认证

retention:
  maxAge: 7d      # 消息最大保留时间
  cleanupInterval: 1h  # 清理间隔
```

---

## 12. 目录结构

```
src/
├── server/
│   ├── index.ts          # 服务器入口
│   ├── routes/
│   │   ├── messages.ts   # 消息 API
│   │   └── agents.ts     # Agent API
│   ├── ws/
│   │   └── handler.ts    # WebSocket 处理
│   ├── db/
│   │   └── index.ts      # SQLite 操作
│   └── types.ts          # 类型定义
│
├── client/
│   ├── index.ts          # Client SDK 入口
│   ├── mailbox.ts        # Mailbox 类
│   └── ws-client.ts      # WebSocket 客户端
│
├── cli/
│   └── index.ts          # 命令行工具
│
└── types.ts              # 共享类型
```

---

## 13. 初期简化决策

| 特性 | 决策 | 原因 |
|------|------|------|
| 认证 | 暂不实现 | 简化初期开发 |
| 图片存储 | 外部 URL | 不自己存储图片 |
| 用户系统 | 无 | Agent 地址即身份 |
| TLS | 可选 | 部署时按需配置 |

---

## 14. TODO

- [ ] 实现服务器核心（HTTP API + WebSocket）
- [ ] 实现 SQLite 数据持久化
- [ ] 实现客户端 SDK
- [ ] 实现 CLI 工具
- [ ] 编写测试
- [ ] 编写文档
