/**
 * TDD: Bounty Prompt Hook Tests
 * 
 * RED Phase: 编写失败的测试
 * 测试 bounty-prompt-hook 的行为
 */

import { describe, it, expect } from 'bun:test';

// ============================================================================
// Test: Bounty Capabilities Content
// ============================================================================

describe('Bounty Prompt Hook - Content', () => {
  // 模拟 hook 的 execute 函数逻辑
  const BOUNTY_CAPABILITIES = `

## Bounty 赏金平台能力

你是一个 AI Agent Bounty 赏金平台的核心助手。除了常规能力外，你还支持以下 Bounty 特有功能：

### 任务管理

| 命令 | 描述 |
|------|------|
| \`bounty publish -t <title> -d <desc> -y <type> -r <reward> -p <publisher-id>\` | 发布赏金任务 |
| \`bounty board\` | 查看任务看板 |
| \`bounty grab <taskId>\` | 认领任务 |
| \`bounty submit <taskId> <result>\` | 提交任务结果 |
| \`bounty complete <taskId>\` | 完成任务并发放奖励 |
| \`bounty cancel <taskId>\` | 取消任务 |

### Agent 管理

| 命令 | 描述 |
|------|------|
| \`bounty agent register <agentId> <name>\` | 注册新 Agent |
| \`bounty agent list\` | 列出所有已注册的 Agent |
| \`bounty agent info <agentId>\` | 查看 Agent 详细信息 |
| \`bounty agent credits <agentId>\` | 查看 Agent 积分余额 |

### 通信功能

| 命令 | 描述 |
|------|------|
| \`bounty com send <to> <content>\` | 向其他 Agent 发送消息 |
| \`bounty com inbox\` | 查看收件箱消息 |
| \`bounty com addresses\` | 查看地址簿 |
| \`bounty com config <agentId>\` | 配置 SMTP/IMAP |
| \`bounty com connect\` | 连接 IMAP IDLE 实时监听 |
| \`bounty com disconnect\` | 断开 IMAP 连接 |

### 使用示例

\`\`\`bash
# 发布一个赏金任务
bounty publish -t "修复登录 Bug" -d "用户无法登录" -y coding -r 100 -p my-agent-id

# 查看任务看板
bounty board

# 认领一个任务
bounty grab task_abc123

# 提交任务结果
bounty submit task_abc123 "已修复，问题是 cookie 过期"

# 查看 Agent 积分
bounty agent credits my-agent-id
\`\`\`

### 核心概念

- **Agent**: 赏金平台中的参与者，可以发布任务或完成任务
- **Bounty Task**: 赏金任务，包含标题、描述、类型、奖励等信息
- **Credits**: 积分，用于发布任务和奖励结算
- **Escrow**: 托管机制，任务完成后才释放奖励
- **IMAP/SMTP**: Agent 间通过邮件协议进行通信
`;

  // 模拟 hook execute 行为
  function executeHook(hookContext: { name: string; renderedContent: string }): void {
    if (hookContext.name !== 'default') {
      return;
    }
    hookContext.renderedContent += BOUNTY_CAPABILITIES;
  }

  it('should append bounty capabilities to default prompt', () => {
    const hookContext = {
      name: 'default',
      renderedContent: 'You are a helpful assistant.',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('Bounty 赏金平台能力');
    expect(hookContext.renderedContent).toContain('bounty publish');
    expect(hookContext.renderedContent).toContain('bounty board');
    expect(hookContext.renderedContent).toContain('bounty agent');
  });

  it('should NOT modify non-default prompts', () => {
    const hookContext = {
      name: 'coding',
      renderedContent: 'You are a coding expert.',
    };
    
    const originalContent = hookContext.renderedContent;
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toBe(originalContent);
  });

  it('should include all task management commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty publish');
    expect(hookContext.renderedContent).toContain('bounty board');
    expect(hookContext.renderedContent).toContain('bounty grab');
    expect(hookContext.renderedContent).toContain('bounty submit');
    expect(hookContext.renderedContent).toContain('bounty complete');
    expect(hookContext.renderedContent).toContain('bounty cancel');
  });

  it('should include all agent management commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty agent register');
    expect(hookContext.renderedContent).toContain('bounty agent list');
    expect(hookContext.renderedContent).toContain('bounty agent info');
    expect(hookContext.renderedContent).toContain('bounty agent credits');
  });

  it('should include all communication commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty com send');
    expect(hookContext.renderedContent).toContain('bounty com inbox');
    expect(hookContext.renderedContent).toContain('bounty com addresses');
    expect(hookContext.renderedContent).toContain('bounty com connect');
    expect(hookContext.renderedContent).toContain('bounty com disconnect');
  });

  it('should include core concepts explanation', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('Agent');
    expect(hookContext.renderedContent).toContain('Bounty Task');
    expect(hookContext.renderedContent).toContain('Credits');
    expect(hookContext.renderedContent).toContain('Escrow');
  });
});

// ============================================================================
// Test: Hook Registration Function
// ============================================================================

describe('Bounty Prompt Hook - Registration', () => {
  it('should export registerBountyPromptHook function', async () => {
    const module = await import('../src/cli/hooks/bounty-prompt-hook.js');
    expect(typeof module.registerBountyPromptHook).toBe('function');
  });

  it('should export bountyPromptHook object', async () => {
    const module = await import('../src/cli/hooks/bounty-prompt-hook.js');
    expect(module.bountyPromptHook).toBeDefined();
    expect(module.bountyPromptHook.name).toBe('bounty-prompt-hook');
  });
});
