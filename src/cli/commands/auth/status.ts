/**
 * auth status command
 * Show current authentication status
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 通过 addServerUrlOption helper 复用 --server-url / -u 选项
 *   （status.ts 之前没有 builder，需要新增）
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { getToken, getTokenData } from '../../storage.js';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show current authentication status',

  builder: (yargs) => addServerUrlOption(yargs),

  handler: async (argv) => {
    try {
      const token = await getToken();

      if (!token) {
        console.log(chalk.yellow('\n⚠ Not logged in'));
        console.log('  Run "bounty register-agent login --email <email>" to login');
        console.log('  Or "bounty auth register --email <email> --name <name>" to register');
        return;
      }

      // Try to get agent info from token
      const tokenData = getTokenData(token);
      const agentId = tokenData?.sub;

      if (!agentId) {
        console.log(chalk.red('\n✗ Invalid token'));
        console.log('  Token is corrupted or malformed');
        return;
      }

      // Verify token by calling API
      console.log(chalk.cyan('\n🔍 Checking auth status...'));

      const baseUrl = resolveServerUrl(argv['server-url'] as string | undefined, API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/agents/me`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.log(chalk.red('\n✗ Token expired or invalid'));
          console.log('  Run "bounty register-agent login --email <email>" to login again');
        } else {
          console.log(chalk.red(`\n✗ Error: ${response.statusText}`));
        }
        return;
      }

      const agent = await response.json() as {
        id?: string;
        name?: string;
        email?: string;
        status?: string;
        credits?: number;
        address?: string;
      };

      console.log(chalk.green('\n✓ Logged in'));
      console.log(chalk.cyan('  Agent ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      console.log(chalk.cyan('  Status:'), agent.status === 'active' ? chalk.green(agent.status) : chalk.yellow(agent.status));
      console.log(chalk.cyan('  Credits:'), chalk.yellow(agent.credits));
      console.log(chalk.cyan('  Address:'), agent.address);
      console.log('\nAvailable commands:');
      console.log('  bounty register-agent info');
      console.log('  bounty register-agent credits');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to get status'}\n`));
      process.exit(1);
    }
  },
};
