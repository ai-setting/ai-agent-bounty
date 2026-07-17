/**
 * @fileoverview Bounty CLI Main Entry
 * 继承 roy-agent CLI 命令并扩展 bounty 特有命令
 */

import yargs, { type Argv } from 'yargs';
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
import { profileCommands } from './commands/profile/index.js';
import { serverCommands } from './commands/server/index.js';

// 注册 Bounty Prompt Hook（注入 bounty 特有命令到 default agent prompt）
import { registerBountyPromptHook } from './hooks/bounty-prompt-hook.js';
// NOTE: registerBountyPromptHook() is called inside runBountyCli() after setQuietMode(true)

// v0.14 BREAKING: BOUNTY_IM_ADDRESS env var + auto-registration of
// `bounty-im` EventSource REMOVED. See CHANGELOG.md and the Decision
// Record (Q5 ✅ DELETE).
//
// Migration:
//   1. `bounty profile use <name>` — sets active identity (ProfileContext)
//   2. Manually register the `bounty-im` EventSource with explicit address
//      in your config file. `bounty-im auto` no longer runs at session start.

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
 *
 * v0.14 BREAKING: auto-registration of `bounty-im` EventSource via
 * `BOUNTY_IM_ADDRESS` env var is REMOVED (Q5 ✅ DELETE). Users who want
 * push-style routing must opt in explicitly via:
 *   1. `bounty profile use <name>` — sets active identity (ProfileContext)
 *   2. Manually register the `bounty-im` EventSource with explicit address.
 * Migration: see CHANGELOG entry for v0.14.0.
 */
async function initializeBountyEnv(): Promise<void> {
  const envService = getOrCreateEnvService();

  // 创建环境（即使没有配置也会初始化组件）
  await envService.create({ quiet: true });

  // 设置全局 env 实例，供 bounty-im-handler 使用
  const env = envService.getEnvironment();
  if (env) {
    setGlobalEnv(env);
  }
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

// ========== PR5: --help 分组配置 ==========

/**
 * PR5 help-grouping 分类定义 (top-level command keys + subcommand paths)。
 *
 * 分组契约:
 * - Quickstart: 新手常用 (auth login / profile add / bounty-task publish / com send 等)
 * - Bounty-specific: bounty 独有的 6 个命令族顶层 (auth/profile/bounty-task/com/register-agent/server)
 * - General: 从 roy-agent-cli 继承的通用命令 (act/interactive/sessions/tasks/...)
 *
 * 当 --all 开启时, 不调用 .group(), 让 yargs 默认按字母顺序列出所有命令。
 */
const PR5_QUICKSTART_GROUPS: ReadonlyArray<readonly [string[], string]> = [
  [
    [
      'help',
      'version',
      'auth login',
      'profile add',
      'bounty-task publish',
      'com send',
    ],
    'Quickstart:',
  ],
];

const PR5_BOUNTY_GROUPS: ReadonlyArray<readonly [string[], string]> = [
  [
    ['auth', 'profile', 'bounty-task', 'com', 'register-agent', 'server'],
    'Bounty-specific:',
  ],
];

const PR5_GENERAL_GROUPS: ReadonlyArray<readonly [string[], string]> = [
  [
    [
      'act',
      'interactive',
      'sessions',
      'tasks',
      'commands',
      'memory',
      'skills',
      'tools',
      'mcp',
    ],
    'General:',
  ],
];

/**
 * 构建 CLI yargs parser (PR5: 暴露为 export 用于测试)。
 *
 * 同步构建一个配置好的 yargs Argv, 不实际执行 .parse()。
 * tests/cli/help.test.ts 通过 .getHelp() 验证分组行为;
 * runBountyCli() 调用此函数后 .parse() 执行实际命令。
 *
 * @param opts.all — true 时跳过 .group() 调用, 让 yargs 默认按字母顺序列出所有命令 (向后兼容)
 */
export function buildBountyCliParser(opts: { all?: boolean } = {}): Argv {
  const envService = getOrCreateEnvService();
  const ActCommand = createActCommand(envService);
  const InteractiveCommand = createInteractiveCommand(envService);
  const version = getVersion();

  const showAll = opts.all === true;

  let parser: Argv = yargs(hideBin(process.argv))
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
    // PR5: --all flag — 显示完整命令列表（绕过分组）
    .option('all', {
      describe: 'Show every command (bypasses --help grouping)',
      type: 'boolean',
      default: false,
      global: true,
    })
    // 全局 middleware，在命令执行前设置 quiet 模式
    .middleware(quietModeMiddleware, true)
    // 在每个命令 handler 前解析 profile 并注入 ProfileContext
    .middleware((argv) => profileMiddleware(argv as Record<string, unknown>))
    .describe('h', 'show help')
    .alias('h', 'help');

  // 注册命令
  parser = parser
    .command(ActCommand)
    .command(InteractiveCommand)
    .command(SessionsCommand)
    .command(TasksCommand)
    .command(CommandsCommand)
    .command(MemoryCommand)
    .command(SkillsCommand)
    .command(ToolsCommand)
    .command(McpCommand)
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
    // Bounty 特有命令
    .command(registerAgentCommands)
    .command(bountyTaskCommands)
    .command(comCommands)
    .command(authCommands)
    .command(profileCommands)
    .command(serverCommands)
    .demandCommand(1, 'See --help for available commands')
    .strict();

  // PR5: 默认按 3 组分类, --all 时不分
  if (!showAll) {
    for (const [keys, label] of PR5_QUICKSTART_GROUPS) {
      parser = parser.group([...keys], label);
    }
    for (const [keys, label] of PR5_BOUNTY_GROUPS) {
      parser = parser.group([...keys], label);
    }
    for (const [keys, label] of PR5_GENERAL_GROUPS) {
      parser = parser.group([...keys], label);
    }
    parser = parser.epilogue('Use --all to see every command (including advanced).');
  }

  return parser;
}

export async function runBountyCli(): Promise<void> {
  try {
    // 在初始化 env 之前设置 quiet 模式，抑制日志噪声
    setQuietMode(true);
    registerBountyPromptHook();

    // CLI 启动时初始化（自动注册 bounty-im EventSource）
    await initializeBountyEnv();

    // PR5: 从 process.argv 读取 --all 标志, 透传给 parser builder
    const showAll = process.argv.includes('--all');
    const parser = buildBountyCliParser({ all: showAll });

    await parser.parse();
  } finally {
    // CLI 退出时清理全局 envService
    await disposeEnvService();
  }
}