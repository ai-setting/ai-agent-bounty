# ai-agent-bounty 项目 Review 报告

> 日期: 2026-06-06
> 版本: 0.3.3

## 概述

- **总代码量**: 8,408 行 (75 个源文件)
- **总测试量**: 3,966 行 (16 个测试文件)
- **测试覆盖率**: 约 47% (测试行数/源文件行数)
- **当前状态**: 170 测试通过, 18 测试失败

## 架构分析

### 模块结构

```
src/
├── auth/         - 认证模块 (JWT, 邮件验证, 路由)
├── bin/          - CLI 入口
├── cli/          - CLI 命令实现
├── im/           - IM 通信系统 (核心)
│   ├── client/   - 客户端 (Mailbox)
│   ├── cli/      - CLI IM 命令
│   ├── db/       - 数据库层
│   ├── eventsource/ - EventSource 集成 (bounty-im-handler)
│   └── server/   - IM 服务器 (HTTP + WebSocket)
├── lib/          - 核心库
│   ├── agent/    - Agent 管理
│   ├── bounty/   - 赏金任务逻辑
│   ├── config/   - 配置管理
│   ├── mail/     - 邮件常量
│   ├── storage/  - 存储层
│   └── utils/    - 工具函数
├── plugin/       - 插件系统
└── server/       - 统一服务器 (BountyHTTPServer)
    └── http/     - HTTP 路由
```

### 架构评价

**优点**:
1. ✅ 模块划分清晰，按功能垂直切分（auth/im/lib/server）
2. ✅ 使用 Bun.serve 的统一端口方案（HTTP + WebSocket 同一端口）
3. ✅ EventSource 接口解耦了 IM 事件处理和 CLI 系统
4. ✅ TDD 测试覆盖了核心数据层和类型

**问题**:
1. ⚠️ **两套 IM 服务器实现**：`src/im/server/`（独立 IM 服务器）和 `src/server/http/`（BountyHTTPServer 集成版本）。两者功能重叠但代码不一致，增加了维护成本。
2. ⚠️ **循环依赖风险**：`bounty-im-handler.ts` 动态导入 `cli.js` 获取 `getGlobalEnv`，容易导致循环依赖。
3. ⚠️ **配置系统冗余**：`bounty-config.ts`、`cli/config.ts`、`.env` 文件三套配置读取方式。

## 已发现的问题

### Bug 1：HTTP API 发送消息未更新送达状态（关键）

**文件**: `src/im/server/http.ts` (handleSendMessage)
**描述**: 通过 HTTP POST `/api/messages` 发送消息时，消息被保存为 `pending` 状态，调用 `pushCallback` 推送给 WS 客户端，但 **DB 状态从未更新为 `delivered`**。
**影响**: 消息一直处于 `pending` 状态，被 `getPendingMessages` 反复返回，导致重复投递。

```typescript
// src/im/server/http.ts - handleSendMessage
this.db.saveMessage(message);  // status = 'pending'

if (this.pushCallback) {
  this.pushCallback(to, message);  // pushes via WS, doesn't update DB
}
// ❌ 缺少 this.db.updateMessageStatus(message.id, 'delivered');
```

相比之下，WS 直接发送的路径会更新状态：
```typescript
// src/im/server/ws.ts - handleMessage
this.db.saveMessage(imMessage);
if (recipient) {
  recipient.socket.send(...);
  this.db.updateMessageStatus(imMessage.id, 'delivered');  // ✅
}
```

### Bug 2：BountyIMInstance 处理消息后未发送 ACK（关键）

**文件**: `src/im/eventsource/bounty-im-handler.ts`
**描述**: `BountyIMInstance.processLine` 收到消息并推送给 agent 处理后，**没有通过 WebSocket 发送 `ack` 事件**来更新消息状态为 `acked`。
**影响**: 消息处理后仍保持 `pending` 或 `delivered` 状态。若 agent 重启或重新连接，该消息可能被再次处理（重复）。

```typescript
// 当前 flow:
// 1. WS server 发送消息 → BountyIMInstance 接收
// 2. processLine 创建事件 → 推送 eventHandler / pushEnvEvent
// 3. Agent 处理消息
// ❌ 没有对 WS 服务器回复 ack
```

### Bug 3：BountyHTTPServer handleWsOpen 发送 pending 状态而非 delivered（中等）

**文件**: `src/server/http/index.ts` (handleWsOpen)
**描述**: BountyHTTPServer 的 `handleWsOpen` 发送 pending 消息时，**发送的是原始 `pending` 状态**，而非更新为 `delivered`。而 `src/im/server/ws.ts` 的 `handleOpen` 会将状态改为 `delivered` 再发送。

```typescript
// BountyHTTPServer (bug):
socket.send(JSON.stringify({
  event: 'message',
  data: msg,  // status 是 'pending'，不是 'delivered'
}));
if (msg.status === 'pending') {
  this.imDb.updateMessageStatus(msg.id, 'delivered');
}

// IMWebSocketServer (correct):
this.db.updateMessageStatus(msg.id, 'delivered');  // ✅ 先更新
socket.send(JSON.stringify({
  event: 'message',
  data: { ...msg, status: 'delivered' },  // ✅ 用 delivered 发送
}));
```

### Bug 4：ACK 机制不一致（中等）

- WS 直接连接 (`im/server/ws.ts`)：`case 'ack'` 处理 `ack` 事件
- BountyHTTPServer (`server/http/index.ts`)：也有 `case 'ack'` 处理
- HTTP API (`server/http/im-routes.ts`)：也有 `POST /messages/ack`
- **Mailbox 客户端** (`im/client/mailbox.ts`)：有 `ack` 方法但**仅通过 HTTP 调用**

**问题**: ACK 路径混乱，WS 客户端（BountyIMInstance）不使用 `ack` 方法，HTTP 客户端（Mailbox）通过 HTTP 调用但消息可能通过 WS 投递。

### Bug 5：pendingMessages 在 handleWsOpen 中过滤逻辑差异

- `im/server/ws.ts` handleOpen：只发 `pending` 消息，更新为 `delivered`
- `server/http/index.ts` handleWsOpen：只发 `pending` 消息，更新为 `delivered`

逻辑一致，但 BountyHTTPServer 的 `pushMessage` 方法既不更新状态，也不处理 pending 消息。

### 代码质量问题

1. **重复代码**: 两套 WS 服务器实现 (im/server/ws.ts 和 server/http/index.ts) 有大量重复逻辑
2. **硬编码端口**: im/server/index.ts 中 WS 端口为 HTTP 端口 + 1，可能与实际配置冲突
3. **缺少类型安全**: `pushMessage` 和 `handleOpen` 中使用 `any` 类型
4. **测试不完整**: 18 个测试失败，主要是 IM WebSocket 集成测试因超时而失败

## 改进建议

### 高优先级
1. **修复 HTTP API 未更新送达状态**：在 `sendMessage` 中推送后立即更新 DB 状态为 `delivered`
2. **BountyIMInstance 添加 ACK 机制**：处理消息后通过 WS 发送 `ack` 事件
3. **统一 BountyHTTPServer 的 handleWsOpen 状态**：发送时使用 `delivered` 状态

### 中优先级
4. **合并两套 IM 服务器**：统一到 BountyHTTPServer，移除冗余的 `im/server/`
5. **消除循环依赖**：重构 `bounty-im-handler.ts` 的 `getGlobalEnv` 动态导入
6. **统一 ACK 路径**：WS 客户端和 HTTP 客户端使用统一的 ACK 机制

### 低优先级
7. **增加类型安全性**：减少 `any` 类型使用
8. **增加集成测试**：覆盖 WS 重连、消息状态流转等场景
9. **配置统一**：将三套配置合并为单一配置源
