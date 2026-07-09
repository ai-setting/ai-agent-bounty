/**
 * auth login command
 * Login to get auth token (convenience command)
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 新增 --server-url / -u 选项：通过 addServerUrlOption helper 复用
 * - 优先级：--server-url > API_BASE（BOUNTY_API_URL env）> 默认
 * - 校验 + trim 由 resolveServerUrl helper 处理
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { saveToken } from '../../storage.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

export const loginCommand: CommandModule = {
  command: 'login',
  describe: 'Login to get auth token (for already verified accounts)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'Agent email',
        })
        .option('agent-id', {
          alias: 'a',
          type: 'string',
          description: 'Agent ID',
        })
    ),

  handler: async (argv) => {
    if (!argv.email && !argv['agent-id']) {
      console.error(chalk.red('\n✗ Error: --email or --agent-id is required\n'));
      console.error('Usage: bounty register-agent login --email user@example.com');
      process.exit(1);
    }

    try {
      const body: { email?: string; agent_id?: string } = {};
      if (argv.email) body.email = argv.email as string;
      if (argv['agent-id']) body.agent_id = argv['agent-id'] as string;

      console.log(chalk.cyan('\n🔑 Logging in...'));

      const baseUrl = resolveServerUrl(argv['server-url'] as string | undefined, API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json() as {
        token?: string;
        agent_id?: string;
        email?: string;
        expires_in?: number;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Login failed'}\n`));
        process.exit(1);
      }

      // Save token
      if (data.token) {
        await saveToken(data.token);
      }
      const expiresIn = data.expires_in ? Math.round(data.expires_in / 3600) : 24;
      
      console.log(chalk.green('\n✓ Login successful!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Email:'), data.email);
      console.log(`  Token saved. Expires in: ${expiresIn} hours`);
      console.log('\nYou can now use:');
      console.log('  bounty auth status');
      console.log('  bounty register-agent info');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Login failed'}\n`));
      process.exit(1);
    }
  },
};
