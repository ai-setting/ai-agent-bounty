# Bounty Server 架构重构设计

> 日期: 2026-05-18
> 状态: Draft

## 1. 背景

当前 `bounty-server` 存在以下问题：

1. **命名不准确**: `IMHTTPServer` 和 `IMWebSocketServer` 的命名无法体现其支持 Bounty 业务的核心能力
2. **架构不清晰**: 路由逻辑混在 `http.ts` 中，难以区分 Auth、Bounty、IM 三大能力边界
3. **端口配置混乱**: 代码硬编码端口 `4002/4003`，`.env.example` 中的 `BOUNTY_PORT=3000` 未被使用

## 2. 目标

1. 重命名类/文件，准确反映 Bounty 业务能力
2. 拆分为独立的路由模块，清晰展示三大能力
3. 支持 `.env` 环境变量配置端口，默认值 4002/4003

## 3. 设计方案

### 3.1 命名变更

| 原名称 | 新名称 |
|--------|--------|
| `IMHTTPServer` | `BountyHTTPServer` |
| `IMWebSocketServer` | `BountyWebSocketServer` |
| `src/im/server/` | `src/server/` |

### 3.2 文件结构

```
src/
├── server/
│   ├── index.ts              # 导出 BountyServer 类
│   ├── http/
│   │   ├── index.ts          # BountyHTTPServer
│   │   ├── auth-routes.ts    # AuthRoutes
│   │   ├── bounty-routes.ts  # BountyRoutes
│   │   └── im-routes.ts      # IMRoutes
│   └── ws/
│       ├── index.ts          # BountyWebSocketServer
│       └── ...
└── im/                       # 保留，作为 IM 功能子模块
    ├── db/
    ├── client/
    └── eventsource/
```

### 3.3 端口配置

```typescript
// start-server.ts
import { config } from 'dotenv';
config();

// 端口配置：支持环境变量，默认值
const HTTP_PORT = parseInt(process.env.BOUNTY_PORT || '4002');
const WS_PORT = process.env.BOUNTY_WS_PORT
  ? parseInt(process.env.BOUNTY_WS_PORT)
  : HTTP_PORT + 1;  // WebSocket 端口默认 = HTTP + 1
```

### 3.4 三大能力架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      BountyHTTPServer                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ AuthRoutes │  │BountyRoutes│  │  IMRoutes   │            │
│  │             │  │            │  │             │            │
│  │ /api/auth/*│  │ /api/tasks/*│  │/api/messages/*│          │
│  │             │  │            │  │             │            │
│  │ • register │  │ • publish  │  │ • send     │            │
│  │ • verify   │  │ • grab     │  │ • get      │            │
│  │ • login    │  │ • submit   │  │ • ack      │            │
│  │ • sendCode │  │ • complete │  │             │            │
│  │             │  │ • cancel   │  │             │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │               Shared Middleware                          │   │
│  │  • JWT Authentication (checkAuth)                       │   │
│  │  • Error Handling                                        │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.5 路由模块接口

```typescript
// AuthRoutes
export interface AuthRoutes {
  registerRoute(req: Request): Promise<Response>;
  verifyRoute(req: Request): Promise<Response>;
  loginRoute(req: Request): Promise<Response>;
  sendCodeRoute(req: Request): Promise<Response>;
}

// BountyRoutes
export interface BountyRoutes {
  getTasks(agentId: string): Response;
  createTask(req: Request, agentId: string): Promise<Response>;
  grabTask(taskId: string, agentId: string): Response;
  submitTask(req: Request, taskId: string, agentId: string): Promise<Response>;
  completeTask(taskId: string): Response;
  cancelTask(taskId: string): Response;
}

// IMRoutes
export interface IMRoutes {
  sendMessage(req: Request): Promise<Response>;
  getMessages(url: URL): Response;
  getMessageById(id: string): Response;
  ackMessages(req: Request): Promise<Response>;
}
```

## 4. 实现步骤

1. 创建 `src/server/` 目录结构
2. 重命名 `IMHTTPServer` → `BountyHTTPServer`
3. 重命名 `IMWebSocketServer` → `BountyWebSocketServer`
4. 拆分路由到独立模块
5. 更新 `start-server.ts` 使用环境变量
6. 更新 `.env.example`
7. 更新所有导入路径
8. 添加/更新测试
9. 更新文档

## 5. .env.example 更新

```bash
# Server Configuration
BOUNTY_PORT=4002              # HTTP 端口（默认 4002）
BOUNTY_WS_PORT=4003           # WebSocket 端口（默认 PORT+1）
BOUNTY_DOMAIN=bounty.example.com
BOUNTY_DB_PATH=./data/bounty.db
BOUNTY_IM_DB_PATH=./data/im.db
```

## 6. 影响范围

- `start-server.ts`
- `scripts/start-im-server.ts`
- `src/im/server/http.ts`
- `src/im/server/ws.ts`
- `src/im/server/index.ts`
- `src/im/index.ts`
- 所有导入上述文件的代码
