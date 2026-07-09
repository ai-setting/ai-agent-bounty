/**
 * agent add command
 * Register a new agent in the bounty system (via API)
 *
 * Phase feat/bounty-add-server-url:
 * - 新增 --server-url / -u 选项：直接指定 Service base URL（带 scheme，如 https://bounty.example.com）。
 *   用途：远程 / 跨网络 / 自定义端口场景，绕过 API_BASE 默认值。
 * - --server-url 优先级最高：若提供，覆盖 API_BASE（BOUNTY_API_URL env）和默认值。
 * - 校验：必须以 http:// 或 https:// 开头（无 scheme 则报错 exit 1）。
 * - 处理：自动 trim 末尾的 /（避免拼接出 //api）。
 * - 输出：成功时打印实际使用的 Service URL，让用户透明。
 *
 * 注：alias 用 -u 而非 -e，因为 -e 在 add.ts 中已被 --email 占用（yargs 重复 alias 会
 * 把两个 option 的值都收集成数组，导致 fetch 拿不到正确字段）。send.ts 用 -e 是因为
 * 它没有 email 选项。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';


interface AddAgentOptions {
  email: string;
  name: string;
  description?: string;
  serverUrl?: string;
}

export const addCommand: CommandModule = {
  command: 'add',
  describe: 'Register a new agent (requires email verification)',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        demandOption: true,
        description: 'Agent email address',
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        description: 'Agent name',
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Agent description (optional)',
      })
      .option('server-url', {
        alias: 'u',
        type: 'string',
        description:
          'Service base URL (e.g., http://localhost:4000 or https://bounty.example.com). ' +
          'When set, overrides BOUNTY_API_URL env var and default. ' +
          'Must start with http:// or https://. Trailing slashes are auto-trimmed.',
      }),

  handler: async (argv) => {
    const options = argv as unknown as AddAgentOptions;

    // 优先级：--server-url > API_BASE
    // --server-url 必须带 scheme（http:// 或 https://），且不含尾斜杠
    let baseUrl: string;
    if (options.serverUrl) {
      const trimmed = options.serverUrl.replace(/\/+$/, '');
      // 安全检查：必须以 http:// 或 https:// 开头
      if (!/^https?:\/\//.test(trimmed)) {
        console.error(
          chalk.red(`\n✗ Invalid --server-url: "${options.serverUrl}". Must start with http:// or https://\n`)
        );
        process.exit(1);
      }
      baseUrl = trimmed;
    } else {
      baseUrl = API_BASE;
    }

    try {
      const response = await bountyFetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: options.email,
          name: options.name,
          description: options.description,
        }),
      });

      const data = await response.json() as {
        agent_id?: string;
        status?: string;
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Registration failed'}\n`));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Registration initiated!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Status:'), data.status);
      console.log(chalk.cyan('  Email:'), options.email);
      console.log(chalk.cyan('  Service:'), baseUrl);
      console.log('\n' + (data.message || ''));
      console.log('\nNext: Check your email and verify with:');
      console.log(chalk.cyan(`  bounty register-agent verify --email ${options.email} --code <code>`));
      console.log();
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Registration failed'}\n`));
      process.exit(1);
    }
  },
};
