/**
 * @fileoverview Bounty CLI Main Entry
 * 继承 roy-agent CLI 命令并扩展 bounty 特有命令
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ========== 统一配置 ==========
import { bountyConfig } from '../lib/config/bounty-config.js';
import { setQuietMode } from '@ai-setting/roy-agent-core';
import { getPackageVersion } from './lib/package-version.js';
import { profileMiddleware } from './middleware/profile-middleware.js';

// ========== 初始化 Bounty IM EventSource Handler ==========
// 自动注册 bounty-im handler 到 EventSourceInitHooks
import '../im/eventsource/index.js';

// 从 roy-agent-cli 导入所有内置命令
import {
  createActCommand,
  createInteractiveCommand,
  SessionsCommand,
  TasksCommand,
  CommandsCommand,
  MemoryCommand,
  SkillsCommand,
  ToolsCommand,
  McpCommand,
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
import { registerAgentCommands } from './commands/register-agent/index.js';
import { bountyTaskCommands } from './commands/bounty-task/index.js';
import { comCommands } from './commands/com/index.js';
import { authCommands } from './commands/auth/index.js';
import { serverCommands } from './commands/server/index.js';

// 注册 Bounty Prompt Hook（注入 bounty 特有命令到 default agent prompt）
import { registerBountyPromptHook } from './hooks/bounty-prompt-hook.js';
// NOTE: registerBountyPromptHook() is called inside runBountyCli() after setQuietMode(true)

// 环境变量
const BOUNTY_IM_AUTO_ES_NAME = 'bounty-im-auto';

/**
 * Get package.json version
 *
 * Delegates to getPackageVersion() which resolves our package's own
 * version regardless of current working directory. This is important
 * because the CLI binary is run from arbitrary cwd by users.
 */
function getVersion(): string {
  return getPackageVersion();
}

/**
 * 全局 EnvironmentService 实例
 * 用于 act/interactive 命令，生命周期贯穿整个 CLI
 */
let globalEnvService: EnvironmentService | null = null;

/**
 * 全局 Environment 实例引用
 * bounty-im-handler 需要通过此引用调用 pushEnvEvent 发布事件
 */
let globalEnvInstance: any = null;

/**
 * 设置全局 Environment 实例
 * 在 envService.create() 后调用，供 bounty-im-handler 使用
 */
export function setGlobalEnv(env: any): void {
  globalEnvInstance = env;
}

/**
 * 获取全局 Environment 实例
 * bounty-im-handler 调用此方法获取 env 并推送 EnvEvent
 */
export function getGlobalEnv(): any {
  return globalEnvInstance;
}

/**
 * 获取或创建全局 EnvironmentService
 * 
 * bounty-im EventSource 需要 env 来 pushEnvEvent，
 * 所以需要保持 envService 的生命周期与 CLI 一致
 */
export function getOrCreateEnvService(): EnvironmentService {
  if (!globalEnvService) {
    const output = new OutputService();
    output.configure({ quiet: true });
    globalEnvService = new EnvironmentService(output);
  }
  return globalEnvService;
}

/**
 * 释放全局 EnvironmentService
 */
export async function disposeEnvService(): Promise<void> {
  if (globalEnvService) {
    await globalEnvService.dispose();
    globalEnvService = null;
  }
}

/**
 * 初始化 Bounty CLI 环境
 * 
 * 1. 创建/获取全局 envService
 * 2. 自动注册 bounty-im EventSource（如果设置了 BOUNTY_IM_ADDRESS）
 */
async function initializeBountyEnv(): Promise<void> {
  const address = process.env.BOUNTY_IM_ADDRESS;
  const envService = getOrCreateEnvService();

  // 创建环境（即使没有配置也会初始化组件）
  await envService.create({ quiet: true });
  
  // 设置全局 env 实例，供 bounty-im-handler 使用
  const env = envService.getEnvironment();
  if (env) {
    setGlobalEnv(env);
  }

  // 如果没有设置 BOUNTY_IM_ADDRESS，不需要注册 EventSource
  if (!address) {
    return;
  }

  // 设置了 BOUNTY_IM_ADDRESS，需要注册 EventSource
  if (!env) {
    return;
  }

  const eventSourceComponent = env.getComponent('event-source') as any;
  if (!eventSourceComponent || typeof eventSourceComponent.register !== 'function') {
    return;
  }

  // 使用 bountyConfig 统一获取 IM Server URL
  const imServerUrl = bountyConfig.getImServerUrl();
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
    // 检查配置是否变化（address 或 imServerUrl 任一变化都需要更新）
    const existingAddress = existing.options?.address;
    const existingUrl = existing.options?.imServerUrl;
    if (existingAddress !== address || existingUrl !== imServerUrl) {
      eventSourceComponent.unregister(BOUNTY_IM_AUTO_ES_NAME);
      eventSourceComponent.register(config);
      console.log(`✅ 已更新 bounty-im EventSource: ${BOUNTY_IM_AUTO_ES_NAME} (${address})`);
    }
    return;
  }

  // 注册新实例（会持久化到 event-sources.json）
  eventSourceComponent.register(config);
  console.log(`✅ 已自动添加 bounty-im EventSource: ${BOUNTY_IM_AUTO_ES_NAME} (${address})`);
}

/**
 * 全局 quiet 模式 middleware
 * 
 * 默认 quiet 开启（减少日志输出），使用 --no-quiet 关闭 quiet 模式
 */
function quietModeMiddleware(argv: Record<string, unknown>): void {
  // 当 quiet 为 true（即没有传 --no-quiet）时，设置 quiet 模式
  if (argv.quiet === true) {
    setQuietMode(true);
  }
}

export async function runBountyCli(): Promise<void> {
  try {
    // 在初始化 env 之前设置 quiet 模式，抑制日志噪声
    setQuietMode(true);
    registerBountyPromptHook();

    // CLI 启动时初始化（自动注册 bounty-im EventSource）
    await initializeBountyEnv();

    // 使用全局 envService 创建 act/interactive 命令
    const envService = getOrCreateEnvService();
    const ActCommand = createActCommand(envService);
    const InteractiveCommand = createInteractiveCommand(envService);

    const version = getVersion();

    await yargs(hideBin(process.argv))
      .scriptName('bounty')
      .version(version)
      .usage('$0 <command> [options]')
      // 全局 quiet 选项（默认 quiet，使用 --no-quiet 开启日志）
      .option('quiet', {
        describe: 'Quiet mode (default: on, use --no-quiet to enable logging)',
        type: 'boolean',
        default: true,
        global: true,
      })
      // 全局 --profile 选项（profile 文件优先于旧 token 文件）
      .option('profile', {
        alias: 'P',
        describe: 'Use the named profile (overrides BOUNTY_PROFILE and active_profile)',
        type: 'string',
        requiresArg: true,
        global: true,
      })
      // 全局 middleware，在命令执行前设置 quiet 模式
      .middleware(quietModeMiddleware, true)
      // 在每个命令 handler 前解析 profile 并注入 ProfileContext
      .middleware((argv) => profileMiddleware(argv as Record<string, unknown>))
      .describe('h', 'show help')
      .alias('h', 'help')

      // 使用传入 envService 创建的 act/interactive 命令
      .command(ActCommand)
      .command(InteractiveCommand)
      .command(SessionsCommand)
      .command(TasksCommand)
      .command(CommandsCommand)
      .command(MemoryCommand)
      .command(SkillsCommand)
      .command(ToolsCommand)
      .command(McpCommand)

      // v0.5.0: Config 命令组已移除（用户需求："去掉 bounty config 相关命令行以及逻辑"）
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
      .command(registerAgentCommands)
      .command(bountyTaskCommands)
      .command(comCommands)
      .command(authCommands)
      .command(serverCommands)

      .demandCommand(1, 'See --help for available commands')
      .strict()
      .parse();
  } finally {
    // CLI 退出时清理全局 envService
    await disposeEnvService();
  }
}
