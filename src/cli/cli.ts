/**
 * @fileoverview Bounty CLI Main Entry
 * 继承 roy-agent CLI 命令并扩展 bounty 特有命令
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { readFileSync } from 'fs';
import { join } from 'path';

// ========== 初始化 Bounty IM EventSource Handler ==========
// 自动注册 bounty-im handler 到 EventSourceInitHooks
import '../im/eventsource/index.js';

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
  EnvironmentService,
  OutputService,
} from '@ai-setting/roy-agent-cli';

// 导入 bounty 特有命令
import { agentCommands } from './commands/agent/index.js';
import { bountyCommands } from './commands/bounty/index.js';
import { comCommands } from './commands/com/index.js';

// 环境变量
const BOUNTY_IM_AUTO_ES_NAME = 'bounty-im-auto';

/**
 * Get package.json version
 */
function getVersion(): string {
  try {
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

/**
 * CLI 启动时初始化
 * 检查环境变量，自动添加/更新 bounty-im EventSource
 * 使用方式：BOUNTY_IM_ADDRESS=xxx bounty interactive --event-source bounty-im-auto
 */
async function initializeCli(): Promise<void> {
  const address = process.env.BOUNTY_IM_ADDRESS;
  if (!address) {
    return;
  }

  const output = new OutputService();
  const envService = new EnvironmentService(output);

  try {
    await envService.create({});
    const env = envService.getEnvironment();
    if (!env) {
      return;
    }

    const eventSourceComponent = env.getComponent('event-source') as any;
    if (!eventSourceComponent || typeof eventSourceComponent.register !== 'function') {
      return;
    }

    const imServerUrl = process.env.BOUNTY_IM_SERVER_URL || 'ws://localhost:3001/ws';
    const config = {
      id: BOUNTY_IM_AUTO_ES_NAME,
      name: 'Bounty IM (Auto)',
      type: 'bounty-im',
      options: {
        address,
        imServerUrl,
      },
    };

    // 检查是否已存在同名实例，如果存在则先移除再重新注册（确保使用最新配置）
    const existing = eventSourceComponent.get(BOUNTY_IM_AUTO_ES_NAME);
    if (existing) {
      // 检查配置是否变化
      const existingUrl = existing.options?.imServerUrl;
      if (existingUrl !== imServerUrl) {
        eventSourceComponent.unregister(BOUNTY_IM_AUTO_ES_NAME);
        eventSourceComponent.register(config);
        console.log(`✅ 已更新 bounty-im EventSource: ${BOUNTY_IM_AUTO_ES_NAME} (${address})`);
      }
      return;
    }

    // 注册新实例（会持久化到 event-sources.json）
    eventSourceComponent.register(config);
    console.log(`✅ 已自动添加 bounty-im EventSource: ${BOUNTY_IM_AUTO_ES_NAME} (${address})`);
  } finally {
    await envService.dispose();
  }
}

export async function runBountyCli(): Promise<void> {
  // CLI 启动时初始化（自动添加 bounty-im EventSource）
  await initializeCli();

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
