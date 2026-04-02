# AI Agent Bounty 邮箱服务与 CLI 扩展实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 AI Agent Bounty 的邮箱服务和 CLI 扩展，包括 IMAP IDLE 实时监听、com 通信命令、CLI 重构为 roy-agent CLI 超集

**Architecture:** 
- 通信服务 (ComService) 封装 SMTP/IMAP 协议
- IMAP IDLE 后台子进程通过 Bun.spawn IPC 与主进程通信
- CLI 继承 roy-agent 命令并扩展 agent/bounty/com 子命令
- SQLite 存储邮件和配置

**Tech Stack:** TypeScript, Bun, better-sqlite3, nodemailer, imap, mailparser, yargs

---

## 一、文件结构概览

```
ai-agent-bounty/src/
├── bin/
│   ├── bounty.ts           # CLI 入口 [修改]
│   └── idle-daemon.ts     # IMAP IDLE 后台进程 [新建]
├── cli/
│   ├── index.ts           # CLI 导出 [新建]
│   ├── commands/
│   │   ├── agent/         # Agent 命令 [扩展]
│   │   ├── bounty/        # Bounty 命令 [扩展]
│   │   ├── com/           # 通信命令 [新建]
│   │   ├── sessions/      # Sessions 命令 [复用]
│   │   └── tasks/         # Tasks 命令 [复用]
│   └── services/
│       └── context.ts     # CLI 服务上下文 [新建]
├── lib/
│   ├── agent/             # [已有]
│   ├── bounty/            # [已有]
│   ├── com/               # [新建] 通信服务
│   │   ├── index.ts
│   │   ├── smtp.ts
│   │   ├── imap.ts
│   │   ├── idle.ts
│   │   ├── channels.ts
│   │   └── ipc.ts
│   ├── mail/              # [已有]
│   └── storage/           # [已有]
└── tools/                 # [已有]
```

---

## 二、实施阶段

### 阶段 1: CLI 重构 (继承 roy 命令)

#### Task 1.1: 分析 roy-agent CLI 结构

**Files:**
- Read: `roy_agent/packages/cli/src/cli.ts`
- Read: `roy_agent/packages/cli/src/commands/sessions/index.ts`
- Read: `roy_agent/packages/cli/src/commands/tasks/index.ts`

- [ ] **Step 1: 读取 roy-agent CLI 核心文件**

读取以下文件了解命令结构：
```
roy_agent/packages/cli/src/cli.ts
roy_agent/packages/cli/src/commands/sessions/index.ts
roy_agent/packages/cli/src/commands/tasks/index.ts
roy_agent/packages/cli/src/commands/act.ts
roy_agent/packages/cli/src/commands/interactive.ts
```

- [ ] **Step 2: 创建 CLI 基础结构**

创建 `src/cli/index.ts`:
```typescript
export { runBountyCli } from './cli';
export { BountyContext } from './services/context';
```

创建 `src/cli/services/context.ts`:
```typescript
import { Database } from '../lib/storage/database.js';
import { AgentService } from '../lib/agent/index.js';
import { BountyService } from '../lib/bounty/index.js';
import { MailService } from '../lib/mail/index.js';
import { ComService } from '../lib/com/index.js';

export interface BountyContext {
  db: Database;
  agentService: AgentService;
  bountyService: BountyService;
  mailService: MailService;
  comService: ComService;
}

export function createContext(): BountyContext {
  const db = new Database({ path: './data/bounty.db' });
  const agentService = new AgentService(db);
  const bountyService = new BountyService(db, agentService);
  const mailService = new MailService(db);
  const comService = new ComService(db, mailService);
  
  return { db, agentService, bountyService, mailService, comService };
}
```

- [ ] **Step 3: 创建 CLI 入口**

修改 `src/bin/bounty.ts`:
```typescript
#!/usr/bin/env bun
import { runBountyCli } from '../cli/index.js';

runBountyCli();
```

创建 `src/cli/cli.ts`:
```typescript
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createContext } from './services/context.js';

// 导入继承的命令
import { SessionsCommand } from '@gddzhaokun/roy-agent-cli';
import { TasksCommand } from '@gddzhaokun/roy-agent-cli';
import { ActCommand } from '@gddzhaokun/roy-agent-cli';
import { InteractiveCommand } from '@gddzhaokun/roy-agent-cli';

// 导入扩展的命令
import { AgentCommands } from './commands/agent/index.js';
import { BountyCommands } from './commands/bounty/index.js';
import { ComCommands } from './commands/com/index.js';

export async function runBountyCli(): Promise<void> {
  const pkg = await import('../package.json', { with: { type: 'json' } });
  const context = createContext();

  await yargs(hideBin(process.argv))
    .scriptName('bounty')
    .version(pkg.default.version)
    .command(ActCommand)
    .command(InteractiveCommand)
    .command(SessionsCommand)
    .command(TasksCommand)
    .command(AgentCommands)
    .command(BountyCommands)
    .command(ComCommands)
    .demandCommand()
    .help()
    .alias('help', 'h')
    .parse();
}
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(cli): create CLI base structure inheriting roy commands"
```

---

#### Task 1.2: 创建 Agent 命令

**Files:**
- Create: `src/cli/commands/agent/index.ts`
- Create: `src/cli/commands/agent/register.ts`
- Create: `src/cli/commands/agent/list.ts`
- Create: `src/cli/commands/agent/info.ts`
- Create: `src/cli/commands/agent/credits.ts`
- Test: `tests/cli/agent.test.ts`

- [ ] **Step 1: 创建 agent/register 命令**

创建 `src/cli/commands/agent/register.ts`:
```typescript
import { Command } from 'yargs';

export const RegisterCommand: Command = {
  command: 'register',
  describe: 'Register a new agent',
  builder: (yargs) =>
    yargs
      .option('name', { alias: 'n', type: 'string', demandOption: true, description: 'Agent name' })
      .option('email', { alias: 'e', type: 'string', demandOption: true, description: 'Agent email' })
      .option('description', { alias: 'd', type: 'string', description: 'Agent description' }),
  handler: async (argv) => {
    const context = await import('../../services/context.js').then(m => m.createContext());
    const agent = context.agentService.register({
      name: argv.name as string,
      email: argv.email as string,
      description: argv.description as string,
    });
    
    const mailAddress = context.mailService.registerAddress(agent.id, agent.name);
    
    console.log('Agent registered successfully');
    console.log('ID:', agent.id);
    console.log('Name:', agent.name);
    console.log('Email:', agent.email);
    console.log('Credits:', agent.credits);
    console.log('Mail:', mailAddress.address);
  },
};
```

- [ ] **Step 2: 创建其他 agent 命令**

创建 `src/cli/commands/agent/list.ts`, `info.ts`, `credits.ts` 类似结构。

创建 `src/cli/commands/agent/index.ts`:
```typescript
import { Command } from 'yargs';
import { RegisterCommand } from './register.js';
import { ListCommand } from './list.js';
import { InfoCommand } from './info.js';
import { CreditsCommand } from './credits.js';

export const AgentCommands: Command = {
  command: 'agent',
  describe: 'Agent management',
  builder: (yargs) => yargs
    .command(RegisterCommand)
    .command(ListCommand)
    .command(InfoCommand)
    .command(CreditsCommand)
    .demandCommand(),
};
```

- [ ] **Step 3: 编写测试**

创建 `tests/cli/agent.test.ts`:
```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createContext } from '../../src/cli/services/context.js';

describe('Agent CLI Commands', () => {
  let context: any;

  beforeAll(() => {
    context = createContext();
  });

  afterAll(() => {
    context.db.close();
  });

  it('should register a new agent', () => {
    const agent = context.agentService.register({
      name: 'TestAgent',
      email: 'test@example.com',
    });
    expect(agent.name).toBe('TestAgent');
    expect(agent.credits).toBe(100);
  });
});
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(cli): add agent commands (register, list, info, credits)"
```

---

#### Task 1.3: 创建 Bounty 命令

**Files:**
- Create: `src/cli/commands/bounty/index.ts`
- Create: `src/cli/commands/bounty/publish.ts`
- Create: `src/cli/commands/bounty/board.ts`
- Create: `src/cli/commands/bounty/grab.ts`
- Create: `src/cli/commands/bounty/submit.ts`
- Create: `src/cli/commands/bounty/complete.ts`
- Create: `src/cli/commands/bounty/cancel.ts`
- Test: `tests/cli/bounty.test.ts`

按照 Task 1.2 的模式实现 publish, board, grab, submit, complete, cancel 命令。

- [ ] **Step 1-7: 实现各命令**

- [ ] **Step 8: 提交**

```bash
git add -A
git commit -m "feat(cli): add bounty commands"
```

---

### 阶段 2: 邮箱配置服务

#### Task 2.1: 创建数据库表

**Files:**
- Modify: `src/lib/storage/database.ts`
- Test: `tests/storage/agent-configs.test.ts`

- [ ] **Step 1: 添加 agent_configs 表**

修改 `src/lib/storage/database.ts`，添加 `initializeAgentConfigs()`:
```typescript
// Create agent_configs table
this.db.exec(`
  CREATE TABLE IF NOT EXISTS agent_configs (
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
  )
`);

this.db.exec(`
  CREATE INDEX IF NOT EXISTS idx_agent_configs_agent 
  ON agent_configs(agent_id)
`);
```

- [ ] **Step 2: 添加 mail_channels 表**

```typescript
// Create mail_channels table
this.db.exec(`
  CREATE TABLE IF NOT EXISTS mail_channels (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    address TEXT NOT NULL,
    status TEXT DEFAULT 'disconnected',
    last_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id),
    FOREIGN KEY (address) REFERENCES mail_addresses(address)
  )
`);
```

- [ ] **Step 3: 编写测试**

创建 `tests/storage/agent-configs.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'bun:test';

describe('Agent Configs Database', () => {
  it('should create agent_configs table', () => {
    // 测试表创建
  });
});
```

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(db): add agent_configs and mail_channels tables"
```

---

#### Task 2.2: 创建 AgentConfigService

**Files:**
- Create: `src/lib/com/agent-config.ts`
- Test: `tests/com/agent-config.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/com/agent-config.test.ts`:
```typescript
import { describe, it, expect, beforeAll } from 'bun:test';
import { Database } from '../../src/lib/storage/database.js';
import { AgentConfigService } from '../../src/lib/com/agent-config.js';

describe('AgentConfigService', () => {
  let db: Database;
  let service: AgentConfigService;

  beforeAll(() => {
    db = new Database({ memory: true });
    service = new AgentConfigService(db);
  });

  it('should save and retrieve agent config', () => {
    service.saveConfig({
      agentId: 'agent-1',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpUser: 'user@gmail.com',
      smtpPassword: 'password',
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      imapUser: 'user@gmail.com',
      imapPassword: 'password',
    });

    const config = service.getConfig('agent-1');
    expect(config?.smtpHost).toBe('smtp.gmail.com');
    expect(config?.imapPort).toBe(993);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test tests/com/agent-config.test.ts`
Expected: FAIL with "AgentConfigService is not defined"

- [ ] **Step 3: 实现服务**

创建 `src/lib/com/agent-config.ts`:
```typescript
import { v4 as uuidv4 } from 'uuid';
import { Database } from '../storage/database.js';

export interface AgentConfig {
  agentId: string;
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure: boolean;
  imapHost?: string;
  imapPort: number;
  imapUser?: string;
  imapPassword?: string;
  imapTls: boolean;
}

export class AgentConfigService {
  private db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  saveConfig(config: AgentConfig): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT OR REPLACE INTO agent_configs 
      (id, agent_id, smtp_host, smtp_port, smtp_user, smtp_password, smtp_secure,
       imap_host, imap_port, imap_user, imap_password, imap_tls, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(),
      config.agentId,
      config.smtpHost,
      config.smtpPort,
      config.smtpUser,
      config.smtpPassword,
      config.smtpSecure ? 1 : 0,
      config.imapHost,
      config.imapPort,
      config.imapUser,
      config.imapPassword,
      config.imapTls ? 1 : 0,
      now,
      now
    );
  }

  getConfig(agentId: string): AgentConfig | null {
    const row = this.db.prepare(
      'SELECT * FROM agent_configs WHERE agent_id = ?'
    ).get(agentId) as any;
    
    if (!row) return null;
    
    return {
      agentId: row.agent_id,
      smtpHost: row.smtp_host,
      smtpPort: row.smtp_port,
      smtpUser: row.smtp_user,
      smtpPassword: row.smtp_password,
      smtpSecure: row.smtp_secure === 1,
      imapHost: row.imap_host,
      imapPort: row.imap_port,
      imapUser: row.imap_user,
      imapPassword: row.imap_password,
      imapTls: row.imap_tls === 1,
    };
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test tests/com/agent-config.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(com): add AgentConfigService"
```

---

### 阶段 3: SMTP 发送服务

#### Task 3.1: 创建 SmtpService

**Files:**
- Create: `src/lib/com/smtp.ts`
- Test: `tests/com/smtp.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/com/smtp.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { SmtpService } from '../../src/lib/com/smtp.js';

describe('SmtpService', () => {
  const service = new SmtpService();

  it('should create smtp service instance', () => {
    expect(service).toBeDefined();
  });

  it('should validate smtp config', () => {
    const validConfig = {
      host: 'smtp.gmail.com',
      port: 587,
      user: 'test@gmail.com',
      password: 'password',
      secure: false,
    };
    expect(service.validateConfig(validConfig)).toBe(true);
  });

  it('should reject invalid smtp config', () => {
    const invalidConfig = {
      host: '',
      port: 587,
      user: 'test@gmail.com',
      password: 'password',
    };
    expect(service.validateConfig(invalidConfig)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test tests/com/smtp.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 SmtpService**

创建 `src/lib/com/smtp.ts`:
```typescript
import nodemailer from 'nodemailer';
import { AgentConfig } from './agent-config.js';

export interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  secure: boolean;
}

export class SmtpService {
  private transporter?: nodemailer.Transporter;

  validateConfig(config: Partial<SmtpConfig>): config is SmtpConfig {
    return !!(
      config.host &&
      config.port > 0 &&
      config.user &&
      config.password
    );
  }

  createTransporter(config: SmtpConfig): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: config.user,
        pass: config.password,
      },
    });
  }

  async send(
    config: SmtpConfig,
    options: {
      from: string;
      to: string;
      subject: string;
      text?: string;
      html?: string;
    }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.validateConfig(config)) {
      return { success: false, error: 'Invalid SMTP config' };
    }

    const transporter = this.createTransporter(config);

    try {
      const info = await transporter.sendMail({
        from: options.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });

      return { success: true, messageId: info.messageId };
    } catch (error: any) {
      return { success: false, error: error.message };
    }
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test tests/com/smtp.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(com): add SmtpService for sending emails"
```

---

#### Task 3.2: 创建 com/send CLI 命令

**Files:**
- Create: `src/cli/commands/com/send.ts`
- Modify: `src/cli/commands/com/index.ts`

- [ ] **Step 1: 创建 send 命令**

创建 `src/cli/commands/com/send.ts`:
```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';
import { SmtpService } from '../../../lib/com/smtp.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';

export const SendCommand: Command = {
  command: 'send',
  describe: 'Send a message via email',
  builder: (yargs) =>
    yargs
      .option('from', { alias: 'f', type: 'string', demandOption: true, description: 'Sender address' })
      .option('to', { alias: 't', type: 'string', demandOption: true, description: 'Recipient address' })
      .option('subject', { alias: 's', type: 'string', demandOption: true, description: 'Email subject' })
      .option('body', { alias: 'b', type: 'string', demandOption: true, description: 'Email body' })
      .option('agent-id', { alias: 'a', type: 'string', demandOption: true, description: 'Agent ID' }),
  handler: async (argv) => {
    const context = createContext();
    const smtpService = new SmtpService();
    const configService = new AgentConfigService(context.db);

    const config = configService.getConfig(argv['agent-id'] as string);
    if (!config) {
      console.error('Agent SMTP config not found. Run: bounty com config --agent-id <id>');
      process.exit(1);
    }

    const result = await smtpService.send(
      {
        host: config.smtpHost!,
        port: config.smtpPort,
        user: config.smtpUser!,
        password: config.smtpPassword!,
        secure: config.smtpSecure,
      },
      {
        from: argv.from as string,
        to: argv.to as string,
        subject: argv.subject as string,
        text: argv.body as string,
      }
    );

    if (result.success) {
      console.log('Message sent successfully');
      console.log('Message ID:', result.messageId);
    } else {
      console.error('Failed to send:', result.error);
      process.exit(1);
    }
  },
};
```

- [ ] **Step 2: 更新 com/index.ts**

```typescript
export const ComCommands: Command = {
  command: 'com',
  describe: 'Communication commands',
  builder: (yargs) => yargs
    .command(SendCommand)
    .command(InboxCommand)
    .command(ConnectCommand)
    .command(DisconnectCommand)
    .command(AddressesCommand)
    .command(StatusCommand)
    .command(ConfigCommand)
    .demandCommand(),
};
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat(cli): add com send command"
```

---

### 阶段 4: IMAP 读取服务

#### Task 4.1: 创建 ImapService

**Files:**
- Create: `src/lib/com/imap.ts`
- Test: `tests/com/imap.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/com/imap.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { ImapService } from '../../src/lib/com/imap.js';

describe('ImapService', () => {
  const service = new ImapService();

  it('should create imap service instance', () => {
    expect(service).toBeDefined();
  });

  it('should validate imap config', () => {
    const validConfig = {
      host: 'imap.gmail.com',
      port: 993,
      user: 'test@gmail.com',
      password: 'password',
      tls: true,
    };
    expect(service.validateConfig(validConfig)).toBe(true);
  });

  it('should reject invalid imap config', () => {
    const invalidConfig = {
      host: '',
      port: 993,
      user: 'test@gmail.com',
      password: 'password',
    };
    expect(service.validateConfig(invalidConfig)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test tests/com/imap.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 ImapService**

创建 `src/lib/com/imap.ts`:
```typescript
import Imap from 'imap';
import { simpleParser } from 'mailparser';

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
}

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
}

export class ImapService {
  validateConfig(config: Partial<ImapConfig>): config is ImapConfig {
    return !!(
      config.host &&
      config.port > 0 &&
      config.user &&
      config.password
    );
  }

  async fetchMessages(
    config: ImapConfig,
    options: {
      box?: string;
      limit?: number;
      unreadOnly?: boolean;
    } = {}
  ): Promise<MailMessage[]> {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid IMAP config');
    }

    const { box = 'INBOX', limit = 50, unreadOnly = false } = options;

    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: config.user,
        password: config.password,
        host: config.host,
        port: config.port,
        tls: config.tls,
      });

      const messages: MailMessage[] = [];

      imap.once('ready', () => {
        imap.openBox(box, false, (err, mailbox) => {
          if (err) {
            imap.end();
            reject(err);
            return;
          }

          const start = Math.max(1, mailbox.messages.total - limit + 1);
          const range = unreadOnly 
            ? `UNSEEN ${start}:*`
            : `${start}:*`;

          const fetch = imap.seq.fetch(range, {
            bodies: '',
            struct: true,
          });

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              simpleParser(stream).then((parsed) => {
                messages.push({
                  id: parsed.messageId || Date.now().toString(),
                  from: parsed.from?.value?.[0]?.text || '',
                  to: parsed.to?.value?.[0]?.text || '',
                  subject: parsed.subject || '',
                  body: parsed.text || '',
                  date: parsed.date || new Date(),
                });
              });
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });

          fetch.once('end', () => {
            imap.end();
            resolve(messages);
          });
        });
      });

      imap.once('error', (err) => {
        reject(err);
      });

      imap.connect();
    });
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test tests/com/imap.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(com): add ImapService for receiving emails"
```

---

#### Task 4.2: 创建 com/inbox CLI 命令

**Files:**
- Create: `src/cli/commands/com/inbox.ts`
- Modify: `src/cli/commands/com/index.ts`

- [ ] **Step 1: 创建 inbox 命令**

创建 `src/cli/commands/com/inbox.ts`:
```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';
import { ImapService } from '../../../lib/com/imap.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';

export const InboxCommand: Command = {
  command: 'inbox',
  describe: 'Check inbox messages',
  builder: (yargs) =>
    yargs
      .option('agent-id', { alias: 'a', type: 'string', demandOption: true, description: 'Agent ID' })
      .option('limit', { alias: 'l', type: 'number', default: 10, description: 'Number of messages' })
      .option('unread', { alias: 'u', type: 'boolean', default: false, description: 'Show only unread' }),
  handler: async (argv) => {
    const context = createContext();
    const imapService = new ImapService();
    const configService = new AgentConfigService(context.db);

    const config = configService.getConfig(argv['agent-id'] as string);
    if (!config) {
      console.error('Agent IMAP config not found. Run: bounty com config --agent-id <id>');
      process.exit(1);
    }

    try {
      const messages = await imapService.fetchMessages(
        {
          host: config.imapHost!,
          port: config.imapPort,
          user: config.imapUser!,
          password: config.imapPassword!,
          tls: config.imapTls,
        },
        {
          limit: argv.limit as number,
          unreadOnly: argv.unread as boolean,
        }
      );

      console.log(`\nInbox (${messages.length} messages):\n`);
      messages.forEach((msg, i) => {
        console.log(`[${i + 1}] From: ${msg.from}`);
        console.log(`    Subject: ${msg.subject}`);
        console.log(`    Date: ${msg.date}`);
        console.log();
      });
    } catch (error: any) {
      console.error('Failed to fetch messages:', error.message);
      process.exit(1);
    }
  },
};
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat(cli): add com inbox command"
```

---

### 阶段 5: IMAP IDLE 实时监听

#### Task 5.1: 创建 IdleService (IMAP IDLE)

**Files:**
- Create: `src/lib/com/idle.ts`
- Test: `tests/com/idle.test.ts`

- [ ] **Step 1: 编写测试**

创建 `tests/com/idle.test.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { IdleService } from '../../src/lib/com/idle.js';

describe('IdleService', () => {
  const service = new IdleService();

  it('should create idle service instance', () => {
    expect(service).toBeDefined();
  });

  it('should validate config', () => {
    const validConfig = {
      host: 'imap.gmail.com',
      port: 993,
      user: 'test@gmail.com',
      password: 'password',
      tls: true,
    };
    expect(service.validateConfig(validConfig)).toBe(true);
  });

  it('should reject invalid config', () => {
    const invalidConfig = { host: '', port: 0, user: '', password: '' };
    expect(service.validateConfig(invalidConfig)).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `bun test tests/com/idle.test.ts`
Expected: FAIL

- [ ] **Step 3: 实现 IdleService**

创建 `src/lib/com/idle.ts`:
```typescript
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { ImapConfig, MailMessage } from './imap.js';

export type NewMailCallback = (message: MailMessage) => void;

export class IdleService {
  private imap?: Imap;
  private running: boolean = false;
  private lastUid: number = 0;
  private reconnectTimeout?: NodeJS.Timeout;

  validateConfig(config: Partial<ImapConfig>): config is ImapConfig {
    return !!(
      config.host &&
      config.port > 0 &&
      config.user &&
      config.password
    );
  }

  async start(config: ImapConfig, onNewMail: NewMailCallback): Promise<void> {
    if (!this.validateConfig(config)) {
      throw new Error('Invalid IMAP config');
    }

    if (this.running) {
      console.warn('IdleService already running');
      return;
    }

    this.running = true;
    this.imap = new Imap({
      user: config.user,
      password: config.password,
      host: config.host,
      port: config.port,
      tls: config.tls,
      keepalive: {
        interval: 30000,
        idleInterval: 1800000,
      },
    });

    this.setupListeners(config, onNewMail);
  }

  private setupListeners(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (!this.imap) return;

    this.imap.on('ready', () => {
      console.log('IMAP IDLE connected');
      this.imap!.openBox('INBOX', false, (err) => {
        if (err) {
          console.error('Failed to open INBOX:', err);
          this.scheduleReconnect(config, onNewMail);
          return;
        }
        this.idle(config, onNewMail);
      });
    });

    this.imap.on('mail', (count: number) => {
      console.log(`New mail detected: ${count} message(s)`);
      this.fetchNewMessages(config, onNewMail);
    });

    this.imap.on('error', (err: Error) => {
      console.error('IMAP error:', err.message);
      this.scheduleReconnect(config, onNewMail);
    });

    this.imap.on('close', () => {
      if (this.running) {
        this.scheduleReconnect(config, onNewMail);
      }
    });

    this.imap.connect();
  }

  private idle(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (!this.imap || !this.running) return;

    try {
      this.imap.idle((err: Error | null) => {
        if (err) {
          console.error('IDLE error:', err.message);
          this.scheduleReconnect(config, onNewMail);
          return;
        }

        // 30分钟后重新进入 IDLE（防止某些服务器断开）
        setTimeout(() => {
          if (this.running && this.imap) {
            this.idle(config, onNewMail);
          }
        }, 30 * 60 * 1000);
      });
    } catch (err) {
      console.error('IDLE exception:', err);
      this.scheduleReconnect(config, onNewMail);
    }
  }

  private async fetchNewMessages(config: ImapConfig, onNewMail: NewMailCallback): Promise<void> {
    if (!this.imap || !this.running) return;

    try {
      const box = await new Promise<any>((resolve, reject) => {
        this.imap!.getBox((err: Error | null, data: any) => {
          if (err) reject(err);
          else resolve(data);
        });
      });

      if (box.messages.total === 0) return;

      const startUid = this.lastUid + 1;
      const fetch = this.imap.seq.fetch(`${startUid}:*`, {
        bodies: '',
        struct: true,
      });

      fetch.on('message', (msg: any) => {
        msg.on('body', (stream: any) => {
          simpleParser(stream).then((parsed: any) => {
            const message: MailMessage = {
              id: parsed.messageId || Date.now().toString(),
              from: parsed.from?.value?.[0]?.text || '',
              to: parsed.to?.value?.[0]?.text || '',
              subject: parsed.subject || '',
              body: parsed.text || '',
              date: parsed.date || new Date(),
            };
            onNewMail(message);
            this.lastUid = Math.max(this.lastUid, startUid);
          });
        });
      });

      fetch.once('error', (err: Error) => {
        console.error('Fetch error:', err.message);
      });
    } catch (err) {
      console.error('Failed to fetch new messages:', err);
    }
  }

  private scheduleReconnect(config: ImapConfig, onNewMail: NewMailCallback): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      if (this.running) {
        console.log('Reconnecting...');
        this.stop();
        this.start(config, onNewMail);
      }
    }, 5000);
  }

  async stop(): Promise<void> {
    this.running = false;

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }

    if (this.imap) {
      this.imap.end();
      this.imap = undefined;
    }

    console.log('IdleService stopped');
  }
}
```

- [ ] **Step 4: 运行测试验证通过**

Run: `bun test tests/com/idle.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(com): add IdleService with IMAP IDLE support"
```

---

#### Task 5.2: 创建后台监听子进程

**Files:**
- Create: `src/bin/idle-daemon.ts`
- Test: `tests/com/idle-daemon.test.ts`

- [ ] **Step 1: 创建 idle-daemon.ts**

创建 `src/bin/idle-daemon.ts`:
```typescript
#!/usr/bin/env bun
/**
 * IMAP IDLE Daemon
 * 后台子进程，用于实时监听新邮件
 */

import { IdleService } from '../lib/com/idle.js';

interface DaemonConfig {
  imap_host: string;
  imap_port: number;
  imap_user: string;
  imap_password: string;
  imap_tls: boolean;
}

function main(): void {
  // 从命令行参数获取配置
  const configArg = process.argv[2];
  const agentId = process.argv[3];

  if (!configArg || !agentId) {
    console.error('Usage: bun idle-daemon.ts <config-json> <agent-id>');
    process.exit(1);
  }

  const config: DaemonConfig = JSON.parse(configArg);
  const idleService = new IdleService();

  // 处理新邮件
  const onNewMail = (mail: any) => {
    const event = {
      type: 'new_mail',
      agentId,
      mail,
      timestamp: Date.now(),
    };
    process.stdout.write(JSON.stringify(event) + '\n');
  };

  // 启动 IDLE
  idleService.start(
    {
      host: config.imap_host,
      port: config.imap_port,
      user: config.imap_user,
      password: config.imap_password,
      tls: config.imap_tls,
    },
    onNewMail
  ).catch((err) => {
    console.error('Failed to start:', err);
    process.exit(1);
  });

  // 处理 stdin 命令
  process.stdin.on('data', (data: Buffer) => {
    try {
      const cmd = JSON.parse(data.toString());
      if (cmd.type === 'stop') {
        idleService.stop().then(() => {
          process.exit(0);
        });
      }
    } catch (err) {
      console.error('Invalid command:', err);
    }
  });

  process.on('SIGTERM', () => {
    idleService.stop().then(() => process.exit(0));
  });

  process.on('SIGINT', () => {
    idleService.stop().then(() => process.exit(0));
  });
}

main();
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "feat(daemon): add IMAP IDLE background daemon"
```

---

#### Task 5.3: 创建 com/connect CLI 命令

**Files:**
- Create: `src/cli/commands/com/connect.ts`
- Create: `src/lib/com/ipc.ts`
- Modify: `src/cli/commands/com/index.ts`

- [ ] **Step 1: 创建 IPC 客户端**

创建 `src/lib/com/ipc.ts`:
```typescript
import { spawn, ChildProcess } from 'bun';

export interface IpcMessage {
  type: string;
  agentId?: string;
  mail?: any;
  timestamp?: number;
}

export class IpcClient {
  private child?: ChildProcess;
  private callbacks: Map<string, (msg: IpcMessage) => void> = new Map();

  async connect(agentId: string, config: any): Promise<void> {
    const configPath = require.resolve('../bin/idle-daemon.ts');
    
    this.child = spawn({
      cmd: ['bun', configPath, JSON.stringify(config), agentId],
      stdout: 'pipe',
      stderr: 'inherit',
      stdin: 'pipe',
    });

    if (this.child.stdout) {
      const reader = this.child.stdout.getReader();
      
      const read = () => {
        reader.read().then(({ done, value }) => {
          if (done) return;
          
          const lines = value.toString().split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const msg = JSON.parse(line) as IpcMessage;
              const callback = this.callbacks.get(msg.type);
              if (callback) {
                callback(msg);
              }
            } catch (e) {
              // ignore parse errors
            }
          }
          read();
        });
      };
      
      read();
    }
  }

  onNewMail(callback: (mail: any) => void): void {
    this.callbacks.set('new_mail', (msg) => {
      callback(msg.mail);
    });
  }

  disconnect(): void {
    if (this.child && this.child.stdin) {
      this.child.stdin.write(JSON.stringify({ type: 'stop' }));
    }
  }

  isConnected(): boolean {
    return this.child !== undefined && !this.child.killed;
  }
}
```

- [ ] **Step 2: 创建 connect 命令**

创建 `src/cli/commands/com/connect.ts`:
```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';
import { IpcClient } from '../../../lib/com/ipc.js';
import { MailService } from '../../../lib/mail/index.js';

// 存储活跃的 IPC 客户端
const activeClients: Map<string, IpcClient> = new Map();

export const ConnectCommand: Command = {
  command: 'connect',
  describe: 'Connect to IMAP server and start IDLE listening',
  builder: (yargs) =>
    yargs
      .option('agent-id', { alias: 'a', type: 'string', demandOption: true, description: 'Agent ID' })
      .option('daemon', { alias: 'd', type: 'boolean', default: false, description: 'Run as daemon' }),
  handler: async (argv) => {
    const context = createContext();
    const configService = new AgentConfigService(context.db);

    const config = configService.getConfig(argv['agent-id'] as string);
    if (!config || !config.imapHost) {
      console.error('Agent IMAP config not found. Run: bounty com config --agent-id <id>');
      process.exit(1);
    }

    const client = new IpcClient();

    client.onNewMail(async (mail) => {
      console.log(`\n[NEW MAIL] From: ${mail.from}`);
      console.log(`Subject: ${mail.subject}`);
      console.log(`Body: ${mail.body.substring(0, 100)}...\n`);
      
      // 存储到数据库
      context.mailService.send({
        fromAddress: mail.from,
        toAddress: mail.to,
        subject: mail.subject,
        body: mail.body,
      });
    });

    try {
      await client.connect(argv['agent-id'] as string, {
        imap_host: config.imapHost,
        imap_port: config.imapPort,
        imap_user: config.imapUser,
        imap_password: config.imapPassword,
        imap_tls: config.imapTls,
      });

      activeClients.set(argv['agent-id'] as string, client);

      console.log(`Connected and listening for ${argv['agent-id']}`);
      
      if (!argv['daemon']) {
        // 保持进程运行
        console.log('Press Ctrl+C to stop...');
        
        process.on('SIGINT', () => {
          client.disconnect();
          activeClients.delete(argv['agent-id'] as string);
          process.exit(0);
        });
      }
    } catch (error: any) {
      console.error('Failed to connect:', error.message);
      process.exit(1);
    }
  },
};
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat(cli): add com connect command with IPC"
```

---

#### Task 5.4: 创建其他 com 命令

**Files:**
- Create: `src/cli/commands/com/disconnect.ts`
- Create: `src/cli/commands/com/addresses.ts`
- Create: `src/cli/commands/com/status.ts`
- Create: `src/cli/commands/com/config.ts`

- [ ] **Step 1: 创建 disconnect 命令**

```typescript
import { Command } from 'yargs';

export const DisconnectCommand: Command = {
  command: 'disconnect',
  describe: 'Disconnect from IMAP server',
  builder: (yargs) =>
    yargs.option('agent-id', { alias: 'a', type: 'string', demandOption: true }),
  handler: async (argv) => {
    // 从 activeClients 中移除并断开
    console.log(`Disconnected from ${argv['agent-id']}`);
  },
};
```

- [ ] **Step 2: 创建 addresses 命令**

```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';

export const AddressesCommand: Command = {
  command: 'addresses',
  describe: 'List communication addresses for an agent',
  builder: (yargs) =>
    yargs.option('agent-id', { alias: 'a', type: 'string', demandOption: true }),
  handler: async (argv) => {
    const context = createContext();
    const mail = context.mailService.getAddressByAgent(argv['agent-id'] as string);
    
    if (mail) {
      console.log(`Address: ${mail.address}`);
    } else {
      console.log('No address found');
    }
  },
};
```

- [ ] **Step 3: 创建 status 命令**

```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';

export const StatusCommand: Command = {
  command: 'status',
  describe: 'Check connection status',
  builder: (yargs) =>
    yargs.option('agent-id', { alias: 'a', type: 'string', demandOption: true }),
  handler: async (argv) => {
    const agentId = argv['agent-id'] as string;
    // 检查 activeClients 中是否有活跃连接
    console.log(`Connection status for ${agentId}: disconnected`);
  },
};
```

- [ ] **Step 4: 创建 config 命令**

```typescript
import { Command } from 'yargs';
import { createContext } from '../../services/context.js';
import { AgentConfigService } from '../../../lib/com/agent-config.js';

export const ConfigCommand: Command = {
  command: 'config',
  describe: 'Configure SMTP/IMAP for an agent',
  builder: (yargs) =>
    yargs
      .option('agent-id', { alias: 'a', type: 'string', demandOption: true })
      .option('smtp-host', { type: 'string' })
      .option('smtp-port', { type: 'number', default: 587 })
      .option('smtp-user', { type: 'string' })
      .option('smtp-pass', { type: 'string' })
      .option('smtp-secure', { type: 'boolean', default: false })
      .option('imap-host', { type: 'string' })
      .option('imap-port', { type: 'number', default: 993 })
      .option('imap-user', { type: 'string' })
      .option('imap-pass', { type: 'string' })
      .option('imap-tls', { type: 'boolean', default: true }),
  handler: async (argv) => {
    const context = createContext();
    const configService = new AgentConfigService(context.db);

    configService.saveConfig({
      agentId: argv['agent-id'] as string,
      smtpHost: argv['smtp-host'] as string,
      smtpPort: argv['smtp-port'] as number,
      smtpUser: argv['smtp-user'] as string,
      smtpPassword: argv['smtp-pass'] as string,
      smtpSecure: argv['smtp-secure'] as boolean,
      imapHost: argv['imap-host'] as string,
      imapPort: argv['imap-port'] as number,
      imapUser: argv['imap-user'] as string,
      imapPassword: argv['imap-pass'] as string,
      imapTls: argv['imap-tls'] as boolean,
    });

    console.log('Configuration saved successfully');
  },
};
```

- [ ] **Step 5: 提交**

```bash
git add -A
git commit -m "feat(cli): add remaining com commands"
```

---

### 阶段 6: 集成与完善

#### Task 6.1: 创建 ComService 总入口

**Files:**
- Create: `src/lib/com/index.ts`
- Modify: `src/cli/services/context.ts`

- [ ] **Step 1: 创建 com/index.ts**

创建 `src/lib/com/index.ts`:
```typescript
export { AgentConfigService, type AgentConfig } from './agent-config.js';
export { SmtpService, type SmtpConfig } from './smtp.js';
export { ImapService, type ImapConfig, type MailMessage } from './imap.js';
export { IdleService, type NewMailCallback } from './idle.js';
export { IpcClient, type IpcMessage } from './ipc.js';

export class ComService {
  constructor() {
    // 预留扩展
  }
}
```

- [ ] **Step 2: 更新 context.ts**

```typescript
import { ComService } from '../com/index.js';

export interface BountyContext {
  // ... 现有字段
  comService: ComService;
}

export function createContext(): BountyContext {
  // ...
  const comService = new ComService();
  
  return { db, agentService, bountyService, mailService, comService };
}
```

- [ ] **Step 3: 提交**

```bash
git add -A
git commit -m "feat(com): create ComService facade"
```

---

#### Task 6.2: 更新 package.json

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新依赖和 scripts**

```json
{
  "name": "@ai-setting/agent-bounty",
  "version": "0.2.0",
  "bin": {
    "bounty": "./dist/bin/bounty.js"
  },
  "scripts": {
    "build": "bun run scripts/build.ts",
    "dev": "bun run src/bin/bounty.ts",
    "test": "bun test",
    "cli": "bun run src/bin/bounty.ts"
  },
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

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "chore: update package.json"
```

---

#### Task 6.3: 端到端测试

**Files:**
- Create: `tests/e2e/com-flow.test.ts`

- [ ] **Step 1: 编写端到端测试**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { createContext } from '../../src/cli/services/context.js';
import { AgentConfigService } from '../../src/lib/com/agent-config.js';
import { SmtpService } from '../../src/lib/com/smtp.js';

describe('Com E2E Flow', () => {
  let context: any;
  let configService: AgentConfigService;
  let smtpService: SmtpService;

  beforeAll(() => {
    context = createContext();
    configService = new AgentConfigService(context.db);
    smtpService = new SmtpService();
  });

  afterAll(() => {
    context.db.close();
  });

  it('should register agent and configure SMTP', () => {
    const agent = context.agentService.register({
      name: 'E2ETestAgent',
      email: 'e2e@example.com',
    });

    configService.saveConfig({
      agentId: agent.id,
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'test@example.com',
      smtpPassword: 'testpass',
      smtpSecure: false,
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapUser: 'test@example.com',
      imapPassword: 'testpass',
      imapTls: true,
    });

    const config = configService.getConfig(agent.id);
    expect(config?.smtpHost).toBe('smtp.example.com');
  });
});
```

- [ ] **Step 2: 提交**

```bash
git add -A
git commit -m "test(e2e): add com flow tests"
```

---

## 三、总结

### 完成检查清单

- [ ] Task 1.1: CLI 基础结构
- [ ] Task 1.2: Agent 命令
- [ ] Task 1.3: Bounty 命令
- [ ] Task 2.1: 数据库表
- [ ] Task 2.2: AgentConfigService
- [ ] Task 3.1: SmtpService
- [ ] Task 3.2: com/send 命令
- [ ] Task 4.1: ImapService
- [ ] Task 4.2: com/inbox 命令
- [ ] Task 5.1: IdleService
- [ ] Task 5.2: idle-daemon 子进程
- [ ] Task 5.3: com/connect 命令
- [ ] Task 5.4: 其他 com 命令
- [ ] Task 6.1: ComService 总入口
- [ ] Task 6.2: package.json 更新
- [ ] Task 6.3: 端到端测试

### 预计工作量

| 阶段 | 任务数 | 复杂度 |
|------|--------|--------|
| Phase 1: CLI 重构 | 3 | 中 |
| Phase 2: 邮箱配置 | 2 | 低 |
| Phase 3: SMTP | 2 | 中 |
| Phase 4: IMAP | 2 | 中 |
| Phase 5: IDLE | 4 | 高 |
| Phase 6: 集成 | 3 | 低 |
