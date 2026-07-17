/**
 * Auth status command.
 *
 * PR3: 显示 active profile 的 token 状态 + 用 profile.api_base 调 /api/agents/me
 * 验证 token 仍然有效。
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import { ProfileContext } from '../../config/context.js';
import { resolveProfileApiBase } from '../../lib/profile-api-base.js';
import { readAuthToken } from '../../lib/auth-token.js';
import { getTokenData } from '../../storage.js';

export const statusCommand: CommandModule = {
  command: 'status',
  describe: 'Show current authentication status',

  builder: (yargs) => addServerUrlOption(yargs),

  handler: async (argv) => {
    try {
      const profile = ProfileContext.getActive();
      const token = readAuthToken();

      if (!token) {
        console.log(chalk.yellow('\n⚠ Not logged in'));
        if (profile) {
          console.log(chalk.cyan('  Active profile:'), profile.name);
          console.log(chalk.cyan('  API base:'), profile.api_base);
        }
        console.log('  Run `bounty auth login` to authenticate the active profile');
        return;
      }

      const tokenData = getTokenData(token);
      const agentId = tokenData?.sub;

      if (!agentId) {
        console.log(chalk.red('\n✗ Invalid token'));
        console.log('  Token is corrupted or malformed');
        return;
      }

      console.log(chalk.cyan('\n🔍 Checking auth status...'));

      const baseUrl = resolveProfileApiBase({
        cliServerUrl: argv['server-url'] as string | undefined,
        fallbackApiBase: API_BASE,
        profile,
        resolveServerUrlFn: resolveServerUrl,
      });

      const response = await bountyFetch(`${baseUrl}/api/agents/me`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.log(chalk.red('\n✗ Token expired or invalid'));
          console.log('  Run `bounty auth login` to re-authenticate the active profile');
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
      if (profile) {
        console.log(chalk.cyan('  Profile:'), profile.name);
        console.log(chalk.cyan('  API base:'), profile.api_base);
      }
      console.log(chalk.cyan('  Agent ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      console.log(
        chalk.cyan('  Status:'),
        agent.status === 'active' ? chalk.green(agent.status) : chalk.yellow(agent.status),
      );
      console.log(chalk.cyan('  Credits:'), chalk.yellow(agent.credits));
      console.log(chalk.cyan('  Address:'), agent.address);
      console.log('\nAvailable commands:');
      console.log('  bounty profile show');
      console.log('  bounty register-agent info');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to get status'}\n`));
      process.exit(1);
    }
  },
};

export default statusCommand;