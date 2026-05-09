/**
 * @fileoverview Bounty CLI Main Entry
 * 继承 roy-agent CLI 命令并扩展 bounty 特有命令
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

// 从 roy-agent-cli 导入所有内置命令
import {
  ActCommand,
  InteractiveCommand,
  SessionsCommand,
  TasksCommand,
  CommandsCommand,
  MemoryCommand,
  SkillsCommand,
  ToolsCommand,
  McpCommand,
  ConfigCommand,
  ConfigListCommand,
  ConfigExportCommand,
  ConfigImportCommand,
  DebugCommand,
  LspCommand,
  LspListCommand,
  LspInstallCommand,
  LspCheckCommand,
  WorkflowCommand,
  WorkflowListCommand,
  WorkflowGetCommand,
  WorkflowAddCommand,
  WorkflowRunCommand,
  WorkflowStatusCommand,
  WorkflowStopCommand,
  WorkflowRemoveCommand,
  WorkflowNodesCommand,
  WorkflowUpdateCommand,
  WorkflowValidateCommand,
  EventSourceCommand,
  EventSourceListCommand,
  EventSourceAddCommand,
  EventSourceStartCommand,
  EventSourceStopCommand,
  EventSourceStatusCommand,
  EventSourceRemoveCommand,
  LogCommand,
  TraceCommand,
  SpanCommand,
} from '@ai-setting/roy-agent-cli';

// 导入 bounty 特有命令
import { agentCommands } from './commands/agent/index.js';
import { bountyCommands } from './commands/bounty/index.js';
import { comCommands } from './commands/com/index.js';

// 注册 Bounty Prompt Hook
import { registerBountyPromptHook } from './hooks/bounty-prompt-hook.js';

// 初始化 Hook（提前注册，确保 Environment 创建时 Hook 已就绪）
registerBountyPromptHook();

/**
 * Get package.json version
 */
function getVersion(): string {
  try {
    // package.json is in project root, go up one level from src/cli/
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

export async function runBountyCli(): Promise<void> {
  const version = getVersion();

  await yargs(hideBin(process.argv))
    .scriptName('bounty')
    .version(version)
    .usage('$0 <command> [options]')
    .describe('h', 'show help')
    .alias('h', 'help')

    // 继承 roy-agent 所有内置命令
    .command(ActCommand)
    .command(InteractiveCommand)
    .command(SessionsCommand)
    .command(TasksCommand)
    .command(CommandsCommand)
    .command(MemoryCommand)
    .command(SkillsCommand)
    .command(ToolsCommand)
    .command(McpCommand)

    // Config 命令组
    .command(ConfigCommand)
    .command(ConfigListCommand)
    .command(ConfigExportCommand)
    .command(ConfigImportCommand)

    // Lsp 命令组
    .command(LspCommand)
    .command(LspListCommand)
    .command(LspInstallCommand)
    .command(LspCheckCommand)

    // Workflow 命令组
    .command(WorkflowCommand)
    .command(WorkflowListCommand)
    .command(WorkflowGetCommand)
    .command(WorkflowAddCommand)
    .command(WorkflowRunCommand)
    .command(WorkflowStatusCommand)
    .command(WorkflowStopCommand)
    .command(WorkflowRemoveCommand)
    .command(WorkflowNodesCommand)
    .command(WorkflowUpdateCommand)
    .command(WorkflowValidateCommand)

    // EventSource 命令组
    .command(EventSourceCommand)
    .command(EventSourceListCommand)
    .command(EventSourceAddCommand)
    .command(EventSourceStartCommand)
    .command(EventSourceStopCommand)
    .command(EventSourceStatusCommand)
    .command(EventSourceRemoveCommand)

    // 其他命令
    .command(LogCommand)
    .command(TraceCommand)
    .command(SpanCommand)
    .command(DebugCommand)

    // 添加 bounty 特有命令
    .command(agentCommands)
    .command(bountyCommands)
    .command(comCommands)

    .demandCommand(1, 'See --help for available commands')
    .strict()
    .parse();
}
