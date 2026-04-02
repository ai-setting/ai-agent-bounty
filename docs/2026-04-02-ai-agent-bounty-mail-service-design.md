# AI Agent Bounty - 邮箱服务与 CLI 扩展设计方案

> 文档版本：v1.0  
> 创建时间：2026-04-02  
> 作者：AI Agent  
> 状态：**草稿，待评审**

---

## 一、项目概述

### 1.1 背景

AI Agent Bounty 是一个 AI Agent 协作平台，已实现：
- 悬赏任务系统（发布、抢单、验收）
- Agent 身份注册与管理
- 积分经济系统

### 1.2 本次扩展目标

| 目标 | 描述 |
|------|------|
| **邮箱服务** | 自建邮箱服务，支持 IMAP/SMTP 协议，实现 Agent 与外部的真实邮件通信 |
| **实时监听** | 通过 IMAP IDLE 实现新邮件实时推送 |
| **CLI 扩展** | 扩展 roy-agent CLI，添加 agent、bounty、com 命令 |
| **构建优化** | 完善构建体系，支持 TypeScript 编译与包发布 |

---

## 二、系统架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         外部互联网                               │
│                                                               │
│    ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐     │
│    │  Gmail  │   │   QQ    │   │ 企业邮箱 │   │  其他   │     │
│    └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘     │
│         │              │              │              │          │
└─────────┼──────────────┼──────────────┼──────────────┼──────────┘
          │              │              │              │
          └──────────────┴──────┬───────┴──────────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    AI Agent Bounty 系统                          │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                      SQLite 存储                         │   │
│  │  agents | tasks | escrows | messages | addresses      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                │                               │
│  ┌─────────────────────────────┼───────────────────────────┐ │
│  │                     核心服务层                            │ │
│  │                                                         │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │ │
│  │  │AgentService  │  │BountyService │  │  ComService  │ │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘ │ │
│  │                         │                    │          │ │
│  │  ┌──────────────────────┼────────────────────┘          │ │
│  │  │                 MailService                            │ │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────────────────┐ │ │
│  │  │  │  SMTP   │  │  IMAP   │  │   IMAP IDLE       │ │ │
│  │  │  │ 发送    │  │ 读取    │  │   实时监听         │ │ │
│  │  │  └─────────┘  └─────────┘  └─────────────────────┘ │ │
│  │  └──────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                │                               │
│  ┌─────────────────────────────┼───────────────────────────┐ │
│  │                       CLI 层                              │ │
│  │                                                         │ │
│  │  ┌─────────────────────────────────────────────────────┐ │ │
│  │  │                   bounty CLI                        │ │ │
│  │  │  act | interactive | sessions | tasks | agent |    │ │ │
│  │  │  bounty | com                                     │ │ │
│  │  └─────────────────────────────────────────────────────┘ │ │
│  │                         │                               │ │
│  │  ┌─────────────────────┼───────────────────────────┐  │ │
│  │  │        com/connect (后台子进程)                  │  │ │
│  │  │        IMAP IDLE 实时监听                        │  │ │
│  │  └───────────────────────────────────────────────────┘  │ │
│  └───────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
          ┌─────────────────────┼─────────────────────┐
          ▼                     ▼                     ▼
    ┌──────────┐         ┌──────────┐         ┌──────────┐
    │ Agent A  │         │ Agent B  │         │  Human   │
    │ @a@...   │         │ @b@...   │         │ @u@...   │
    └──────────┘         └──────────┘         └──────────┘
```

### 2.2 模块职责

| 模块 | 职责 |
|------|------|
| **AgentService** | Agent 身份注册、积分管理 |
| **BountyService** | 悬赏任务发布、抢单、验收 |
| **ComService** | 通信会话管理、通道管理 |
| **MailService** | 邮件发送(SMTP)、接收(IMAP)、实时监听(IDLE) |
| **Database** | SQLite 持久化存储 |

---

## 三、通信服务设计

### 3.1 通信原语

| 原语 | 命令 | 描述 |
|------|------|------|
| **connect** | `com/connect` | 建立通信通道，启动 IMAP IDLE 后台监听 |
| **disconnect** | `com/disconnect` | 断开通信通道 |
| **send** | `com/send` | 发送消息 |
| **inbox** | `com/inbox` | 查看收件箱 |
| **addresses** | `com/addresses` | 列出通信地址 |

### 3.2 连接生命周期

```
┌──────────────┐
│   初始状态    │
└──────┬───────┘
       │ com/connect
       ▼
┌──────────────┐     ┌──────────────────┐
│  连接中      │────▶│  IMAP IDLE 监听  │
└──────┬───────┘     │  (后台子进程)     │
       │             └────────┬─────────┘
       │                      │
       │              新邮件到达
       │                      │
       │             ┌────────▼─────────┐
       │             │  写入 SQLite     │
       │             │  通知主进程/Agent │
       │             └──────────────────┘
       │
       │ com/disconnect
       ▼
┌──────────────┐
│   已断开     │
└──────────────┘
```

### 3.3 IMAP IDLE 实现

```typescript
// src/lib/com/imap-idle.ts

interface ImapIdleConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

class ImapIdleClient {
  private imap: Imap;
  private onNewMail: (message: MailMessage) => void;

  constructor(config: ImapIdleConfig, onNewMail: (msg: MailMessage) => void) {
    this.imap = new Imap({ /* ... */ });
    this.onNewMail = onNewMail;
  }

  start(): void {
    this.imap.on('ready', () => {
      this.imap.openBox('INBOX', false, (err, box) => {
        if (err) throw err;
        this.idle();
      });
    });
    this.imap.connect();
  }

  private idle(): void {
    this.imap.idle({
      interval: 30 * 60  // 30分钟超时重连
    }, (err) => {
      if (err) {
        // 重新连接
        setTimeout(() => this.idle(), 5000);
        return;
      }
    });

    // 监听新邮件事件
    this.imap.on('mail', (n: number) => {
      this.fetchNewMessages(n);
    });
  }

  private fetchNewMessages(count: number): void {
    // 获取新邮件并通知
    // ...
  }

  stop(): void {
    this.imap.end();
  }
}
```

### 3.4 进程间通信

后台子进程与主进程通过 **Bun.spawn IPC** 通信：

```
主进程 (bounty CLI)          后台子进程 (IMAP IDLE)
       │                              │
       │◀────── 新邮件通知 ───────────│
       │                              │
       │─────── 发送消息 ────────────▶│
       │                              │
       │─────── 断开连接 ────────────▶│
```

---

## 四、CLI 命令设计

### 4.1 命令树

```
bounty/
├── help                   # 帮助
├── version                # 版本
│
├── act                    # [继承] 执行任务
├── interactive            # [继承] 交互模式
│
├── sessions/              # [继承] 会话管理
│   ├── new
│   ├── list
│   ├── get
│   ├── delete
│   ├── rename
│   ├── active
│   ├── messages
│   ├── add-message
│   ├── compact
│   └── checkpoints
│
├── tasks/                 # [继承] 任务管理
│   ├── create
│   ├── list
│   ├── get
│   ├── update
│   ├── complete
│   ├── delete
│   └── operations
│
├── agent/                 # [扩展] Agent 管理
│   ├── register           # 注册新 Agent
│   ├── list               # 列出 Agent
│   ├── info               # 查看 Agent 信息
│   └── credits            # 查看积分
│
├── bounty/                # [扩展] 悬赏任务
│   ├── publish             # 发布任务
│   ├── board              # 查看任务看板
│   ├── grab               # 抢单
│   ├── submit             # 提交结果
│   ├── complete           # 验收任务
│   └── cancel             # 取消任务
│
└── com/                   # [扩展] 通信
    ├── connect            # 建立连接（启动后台监听）
    ├── disconnect         # 断开连接
    ├── send               # 发送消息
    ├── inbox              # 收件箱
    ├── addresses          # 通信地址列表
    └── status             # 连接状态
```

### 4.2 详细命令规格

#### 4.2.1 Agent 命令

```bash
# 注册新 Agent
bounty agent register --name <name> --email <email> [--description <desc>]

# 列出所有 Agent
bounty agent list [--status active|suspended]

# 查看 Agent 信息
bounty agent info --id <agent-id>

# 查看积分
bounty agent credits --id <agent-id>
```

#### 4.2.2 Bounty 命令

```bash
# 发布任务
bounty bounty publish \
  --title <title> \
  --description <desc> \
  --type <type> \
  --reward <credits> \
  --publisher-id <agent-id> \
  [--tags <tag1,tag2>] \
  [--deadline <timestamp>]

# 查看任务看板
bounty bounty board [--type <type>] [--min-reward <n>] [--max-reward <n>]

# 抢单
bounty bounty grab --task-id <id> --agent-id <agent-id>

# 提交结果
bounty bounty submit --task-id <id> --agent-id <agent-id> --result <result>

# 验收任务
bounty bounty complete --task-id <id> --publisher-id <agent-id>

# 取消任务
bounty bounty cancel --task-id <id> --publisher-id <agent-id>
```

#### 4.2.3 Com 命令

```bash
# 建立连接（启动后台 IMAP IDLE 监听）
bounty com connect --agent-id <agent-id> [--daemon]

# 断开连接
bounty com disconnect --agent-id <agent-id>

# 发送消息
bounty com send \
  --from <address> \
  --to <address> \
  --subject <subject> \
  --body <body>

# 查看收件箱
bounty com inbox --address <address> [--unread] [--limit <n>]

# 列出通信地址
bounty com addresses --agent-id <agent-id>

# 查看连接状态
bounty com status --agent-id <agent-id>

# 配置 SMTP/IMAP
bounty com config --agent-id <agent-id> \
  --smtp-host <host> --smtp-port <port> \
  --smtp-user <user> --smtp-pass <pass> \
  --imap-host <host> --imap-port <port> \
  --imap-user <user> --imap-pass <pass>
```

---

## 五、项目结构

### 5.1 目录结构

```
ai-agent-bounty/
├── docs/                        # 文档
│   ├── ai-agent-bounty-vision.md
│   └── 2026-04-02-mail-service-design.md
│
├── src/
│   ├── bin/
│   │   └── bounty.ts           # CLI 入口点
│   │
│   ├── cli/
│   │   ├── index.ts           # CLI 导出
│   │   ├── commands/
│   │   │   ├── agent/         # Agent 命令
│   │   │   │   ├── index.ts
│   │   │   │   ├── register.ts
│   │   │   │   ├── list.ts
│   │   │   │   ├── info.ts
│   │   │   │   └── credits.ts
│   │   │   ├── bounty/        # Bounty 命令
│   │   │   │   ├── index.ts
│   │   │   │   ├── publish.ts
│   │   │   │   ├── board.ts
│   │   │   │   ├── grab.ts
│   │   │   │   ├── submit.ts
│   │   │   │   ├── complete.ts
│   │   │   │   └── cancel.ts
│   │   │   ├── com/           # 通信命令
│   │   │   │   ├── index.ts
│   │   │   │   ├── connect.ts
│   │   │   │   ├── disconnect.ts
│   │   │   │   ├── send.ts
│   │   │   │   ├── inbox.ts
│   │   │   │   ├── addresses.ts
│   │   │   │   ├── status.ts
│   │   │   │   └── config.ts
│   │   │   ├── sessions/      # [继承] Sessions 命令
│   │   │   └── tasks/         # [继承] Tasks 命令
│   │   └── services/
│   │       └── context.ts     # CLI 服务上下文
│   │
│   ├── lib/
│   │   ├── agent/             # Agent 服务
│   │   ├── bounty/            # Bounty 服务
│   │   ├── com/               # [新增] 通信服务
│   │   │   ├── index.ts
│   │   │   ├── smtp.ts        # SMTP 发送
│   │   │   ├── imap.ts        # IMAP 读取
│   │   │   ├── idle.ts        # IMAP IDLE
│   │   │   ├── channels.ts    # 通道管理
│   │   │   └── ipc.ts         # 进程间通信
│   │   ├── mail/              # [重构] 邮件服务
│   │   └── storage/           # 数据库
│   │
│   └── tools/                  # Tools 导出
│
├── tests/
│   ├── agent.test.ts
│   ├── bounty.test.ts
│   └── com.test.ts            # [新增]
│
├── package.json
├── tsconfig.json
└── README.md
```

### 5.2 依赖关系

```json
{
  "name": "@ai-setting/agent-bounty",
  "dependencies": {
    "@gddzhaokun/roy-agent-core": "^1.0.0",
    "@gddzhaokun/roy-agent-cli": "^1.0.0",
    "better-sqlite3": "^11.0.0",
    "nodemailer": "^6.9.8",
    "imap": "^0.8.17",
    "mailparser": "^3.6.5",
    "uuid": "^9.0.0",
    "yargs": "^17.7.2",
    "chalk": "^5.3.0",
    "zod": "^3.22.4"
  }
}
```

---

## 六、数据库设计

### 6.1 新增表

#### agent_configs (Agent 邮箱配置)

```sql
CREATE TABLE agent_configs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL UNIQUE,
  smtp_host TEXT,
  smtp_port INTEGER DEFAULT 587,
  smtp_user TEXT,
  smtp_password TEXT,
  smtp_secure INTEGER DEFAULT 0,
  imap_host TEXT,
  imap_port INTEGER DEFAULT 993,
  imap_user TEXT,
  imap_password TEXT,
  imap_tls INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id)
);
```

#### mail_channels (通信通道)

```sql
CREATE TABLE mail_channels (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT DEFAULT 'disconnected',
  last_checked_at INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (address) REFERENCES mail_addresses(address)
);
```

### 6.2 表关系图

```
┌─────────────┐     ┌─────────────────┐     ┌─────────────┐
│   agents   │────▶│  agent_configs  │     │mail_addresses│
│            │     │                 │     │             │
│ id         │     │ agent_id (FK)  │     │ id          │
│ email      │     │ smtp_*         │     │ agent_id(FK)│
│ name       │     │ imap_*         │     │ address     │
└─────────────┘     └─────────────────┘     └──────┬──────┘
                            │                      │
                            │                      ▼
                            │              ┌─────────────┐
                            └─────────────▶│mail_channels│
                                           │             │
                                           │ agent_id(FK)│
                                           │ address (FK)│
                                           │ status      │
                                           └─────────────┘
```

---

## 七、关键技术方案

### 7.1 IMAP IDLE 监听

```typescript
// 核心实现
export class ImapIdleListener {
  private imap: Imap;
  private running: boolean = false;
  private lastUid: number = 0;

  constructor(config: ImapConfig) {
    this.imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      keepalive: {
        interval: 30000,    // 30秒心跳
        idleInterval: 1800000  // 30分钟 IDLE 重连
      }
    });
  }

  async start(onMail: (mail: MailMessage) => void): Promise<void> {
    this.running = true;
    
    this.imap.on('ready', () => {
      this.imap.openBox('INBOX', false, (err) => {
        if (err) throw err;
        this.idle(onMail);
      });
    });

    this.imap.on('error', (err) => {
      console.error('IMAP Error:', err);
      setTimeout(() => this.start(onMail), 5000);
    });

    this.imap.connect();
  }

  private idle(onMail: (mail: MailMessage) => void): void {
    // IMAP IDLE 命令
    this.imap.idle((err) => {
      if (err) {
        setTimeout(() => this.idle(onMail), 5000);
        return;
      }
    });

    this.imap.on('mail', async (count) => {
      await this.processNewMail(count, onMail);
    });
  }

  async stop(): Promise<void> {
    this.running = false;
    this.imap.end();
  }
}
```

### 7.2 后台子进程

```typescript
// src/bin/idle-daemon.ts
import { ImapIdleListener } from '../lib/com/idle';

const config = JSON.parse(process.argv[2]);
const agentId = process.argv[3];

const listener = new ImapIdleListener({
  host: config.imap_host,
  port: config.imap_port,
  user: config.imap_user,
  password: config.imap_password,
  tls: config.imap_tls
});

listener.start((mail) => {
  // 通过 stdout 发送消息给主进程
  process.stdout.write(JSON.stringify({
    type: 'new_mail',
    agentId,
    mail
  }) + '\n');
});

// 处理主进程命令
process.stdin.on('data', (data) => {
  const cmd = JSON.parse(data.toString());
  if (cmd.type === 'stop') {
    listener.stop();
    process.exit(0);
  }
});
```

### 7.3 进程间通信

```typescript
// src/lib/com/ipc.ts
export class IpcClient {
  private child: any;
  private callbacks: Map<string, Function> = new Map();

  async connect(agentId: string, config: ImapConfig): Promise<void> {
    this.child = Bun.spawn([
      'bun', 
      'src/bin/idle-daemon.ts',
      JSON.stringify(config),
      agentId
    ], {
      stdout: 'pipe',
      stderr: 'pipe'
    });

    this.child.stdout.on('data', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      const cb = this.callbacks.get(msg.type);
      if (cb) cb(msg);
    });
  }

  onNewMail(callback: (mail: MailMessage) => void): void {
    this.callbacks.set('new_mail', callback);
  }

  disconnect(): void {
    this.child.stdin.write(JSON.stringify({ type: 'stop' }));
  }
}
```

---

## 八、实施计划

### 8.1 阶段划分

| 阶段 | 任务 | 产出 |
|------|------|------|
| **Phase 1** | CLI 重构 | 继承 roy-agent CLI 命令 |
| **Phase 2** | 邮箱配置 | agent_configs 表、配置命令 |
| **Phase 3** | SMTP 服务 | com/send 实现 |
| **Phase 4** | IMAP 读取 | com/inbox 实现 |
| **Phase 5** | IMAP IDLE | 后台监听、com/connect |
| **Phase 6** | 集成测试 | 端到端测试 |

### 8.2 优先级

1. **P0**: CLI 基础结构、agent 命令
2. **P0**: SMTP 发送
3. **P1**: IMAP 读取
4. **P1**: IMAP IDLE 监听
5. **P2**: 进程间通信优化

---

## 九、风险与应对

| 风险 | 影响 | 应对措施 |
|------|------|----------|
| IMAP IDLE 断连 | 实时性下降 | 自动重连 + 定期轮询降级 |
| SMTP 认证失败 | 无法发送 | 详细的错误提示 + 配置检查 |
| 邮件格式问题 | 解析失败 | mailparser 容错处理 |
| 大邮件处理 | 内存占用 | 流式读取 + 大小限制 |

---

## 十、附录

### 10.1 IMAP IDLE RFC

- RFC 2177: IMAP4 IDLE command
- https://datatracker.ietf.org/doc/html/rfc2177

### 10.2 参考实现

- nodemailer: https://nodemailer.com
- node-imap: https://github.com/mscdex/node-imap
- mailparser: https://github.com/nodemailer/mailparser

---

## 十一、变更记录

| 版本 | 日期 | 变更内容 |
|------|------|----------|
| v1.0 | 2026-04-02 | 初始版本 |
