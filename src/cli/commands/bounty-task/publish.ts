/**
 * bounty publish command
 *
 * Phase feat/bounty-task-optimize:
 * - 重构从"本地 DB 直连"为"HTTP API 调用"（与 com send 对齐）
 * - 新增 --server-url / -u 选项，支持远程 bounty server
 * - 自动从 ~/.config/bounty/token 读 JWT（readAuthToken helper）
 * - --publisher-id 缺省时从 BOUNTY_IM_ADDRESS 推断（resolveCurrentAgent helper）
 * - 用 bountyHttp() 统一错误分类（network/auth/business/server）
 * - 移除 createContext() 调用，不再直连 SQLite
 *
 * 错误体验：失败时根据 BountyHttpError.type 给出友好提示 + 不同 exit code
 *   - network (连接拒绝/超时) → 提示启动 server
 *   - auth (401/403) → 提示登录
 *   - business (4xx) → 显示 server 错误信息
 *   - server (5xx) → 提示 server 端问题
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { addServerUrlOption, resolveServerUrl } from '../../lib/server-url-option.js';
import { bountyHttp, BountyHttpError } from '../../lib/bounty-http.js';
import { resolveCurrentAgent } from '../../lib/current-agent.js';
import { generateIdempotencyKey } from '../../lib/idempotency-key.js';

interface PublishOptions {
  title: string;
  description: string;
  type: string;
  reward: number;
  'publisher-id'?: string;
  tags?: string;
  deadline?: number;
  'server-url'?: string;
  'idempotency-key'?: string;
}

interface BountyTask {
  id: string;
  title: string;
  description: string;
  type: string;
  reward: number;
  status: string;
  publisherId: string;
  tags?: string[];
}

export const publishCommand: CommandModule<object, PublishOptions> = {
  command: 'publish',
  describe: 'Publish a new bounty task (via HTTP API)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('title', {
          alias: 't',
          type: 'string',
          demandOption: true,
          description: 'Task title',
        })
        .option('description', {
          alias: 'd',
          type: 'string',
          demandOption: true,
          description: 'Task description',
        })
        .option('type', {
          alias: 'y',
          type: 'string',
          demandOption: true,
          description: 'Task type (e.g., coding, writing, research)',
        })
        .option('reward', {
          alias: 'r',
          type: 'number',
          demandOption: true,
          description: 'Reward credits (must be > 0)',
        })
        .option('publisher-id', {
          alias: 'p',
          type: 'string',
          description:
            'Publisher agent ID. ' +
            'Defaults to BOUNTY_IM_ADDRESS env (e.g., "agent-uuid@host" → "agent-uuid").',
        })
        .option('tags', {
          alias: 'g',
          type: 'string',
          description: 'Comma-separated tags',
        })
        .option('deadline', {
          alias: 'l',
          type: 'number',
          description: 'Deadline timestamp (ms since epoch)',
        })
        .option('idempotency-key', {
          alias: 'k',
          type: 'string',
          description:
            'Optional Idempotency-Key for safe retry (server dedupes 24h). ' +
            'Default: auto-generated from uuid+title+publisher.',
        })
    ),

  handler: async (argv) => {
    // 1. Resolve base URL: --server-url > BOUNTY_API_URL env > default
    const baseUrl = resolveServerUrl(argv['server-url'], bountyConfig.apiUrl);

    // 2. Resolve publisher ID: --publisher-id > BOUNTY_IM_ADDRESS > error
    let publisherId = argv['publisher-id'] ?? resolveCurrentAgent();
    if (!publisherId) {
      console.error(
        chalk.red(
          '\n✗ Cannot infer publisher ID. Provide --publisher-id or set BOUNTY_IM_ADDRESS.\n'
        )
      );
      process.exit(2);
    }

    // 3. Validate inputs (basic client-side checks before HTTP call)
    if (!argv.reward || argv.reward <= 0) {
      console.error(chalk.red('\n✗ --reward must be a positive number.\n'));
      process.exit(2);
    }

    // 4. Parse tags
    const tags = argv.tags
      ? argv.tags.split(',').map((t) => t.trim()).filter(Boolean)
      : undefined;

    // 5. Resolve Idempotency-Key (D.4):
    //    user-provided > auto-generated from uuid+title+publisher.
    //    Server dedupes within 24h window so retried publishes don't
    //    create duplicate tasks / double-charge credits.
    const idempotencyKey =
      argv['idempotency-key']?.trim() ||
      generateIdempotencyKey({
        uuid: resolveCurrentAgent() ?? publisherId,
        title: argv.title.trim(),
        publisher: publisherId,
      });

    // 6. Call HTTP API
    try {
      const task = await bountyHttp<BountyTask>({
        baseUrl,
        path: '/api/tasks',
        method: 'POST',
        body: {
          title: argv.title.trim(),
          description: argv.description.trim(),
          type: argv.type.trim(),
          reward: argv.reward,
          tags,
          deadline: argv.deadline,
          // Note: server reads publisherId from auth agentId, but we also
          // pass it in body for token-less / dev mode where server trusts body
          publisherId,
        },
        extraHeaders: {
          'Idempotency-Key': idempotencyKey,
        },
      });

      // 6. Pretty output
      console.log(chalk.green('\n✓ Task published successfully\n'));
      console.log(chalk.cyan('  ID:'), task.id);
      console.log(chalk.cyan('  Title:'), task.title);
      console.log(chalk.cyan('  Type:'), task.type);
      console.log(chalk.cyan('  Reward:'), task.reward, 'credits');
      console.log(chalk.cyan('  Status:'), task.status);
      if (task.tags && task.tags.length > 0) {
        console.log(chalk.cyan('  Tags:'), task.tags.join(', '));
      }
      console.log();
    } catch (error: any) {
      handleBountyError(error, 'publish task', baseUrl);
    }
  },
};

/**
 * Centralized error handler for bounty-task HTTP errors.
 * Provides user-friendly messages based on error type.
 *
 * Exit code mapping:
 * - 2: usage error / business validation
 * - 3: auth required
 * - 4: network / server issue
 */
export function handleBountyError(error: any, action: string, baseUrl: string): never {
  if (error instanceof BountyHttpError) {
    console.error(chalk.red(`\n✗ Failed to ${action}:`));
    console.error(chalk.red(`  ${error.message}\n`));

    // D.1: For 409 Conflict (e.g., task already grabbed), surface the
    // current owner so the user knows who beat them. The server passes
    // `currentOwner: { id, email, name }` and `currentStatus` in the body.
    if (error.status === 409 && error.currentOwner) {
      const co = error.currentOwner;
      const display = co.name ? `${co.name} <${co.email}>` : co.email ?? co.id;
      console.error(
        chalk.yellow(
          `  💡 This task is already ${error.currentStatus ?? 'taken'}; ` +
            `currently held by ${display}.`
        )
      );
      console.error();
    }

    const exitCode =
      error.type === 'auth' ? 3 :
      error.type === 'network' || error.type === 'server' ? 4 :
      2;
    process.exit(exitCode);
  }

  console.error(
    chalk.red(`\n✗ Unexpected error while trying to ${action}:`),
    error instanceof Error ? error.message : String(error)
  );
  console.error(chalk.gray(`  Server: ${baseUrl}\n`));
  process.exit(1);
}