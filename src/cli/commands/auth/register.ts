/**
 * Auth register command.
 *
 * PR3: 用 active profile 的 api_base 调用 /api/auth/register；register 接口通常不返回
 * token（需要 verify 后才有），所以不写 profile.auth。如果 active profile 不存在，
 * 回退到 `--server-url` / `API_BASE`。
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

export const registerCommand: CommandModule = {
  command: 'register',
  describe: 'Register a new agent (sends verification code to email)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'Agent email',
          demandOption: true,
        })
        .option('name', {
          alias: 'n',
          type: 'string',
          description: 'Agent name',
          demandOption: true,
        })
        .option('description', {
          alias: 'd',
          type: 'string',
          description: 'Agent description (optional)',
        })
    ),

  handler: async (argv) => {
    try {
      const body: { email: string; name: string; description?: string } = {
        email: argv.email as string,
        name: argv.name as string,
      };

      if (argv.description) {
        body.description = argv.description as string;
      }

      console.log(chalk.cyan('\n📝 Registering agent...'));

      const profile = ProfileContext.getActive();
      const baseUrl = resolveProfileApiBase({
        cliServerUrl: argv['server-url'] as string | undefined,
        fallbackApiBase: API_BASE,
        profile,
        resolveServerUrlFn: resolveServerUrl,
      });

      const response = await bountyFetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

      console.log(chalk.green('\n✓ Registration successful!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Status:'), data.status);
      if (profile) {
        console.log(chalk.cyan('  Profile:'), profile.name, chalk.gray(`(${profile.api_base})`));
      }
      console.log(`  ${data.message || 'Please check your email for verification code'}`);
      console.log('\nNext step:');
      console.log('  bounty auth verify --email ' + argv.email);
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Registration failed'}\n`));
      process.exit(1);
    }
  },
};

export default registerCommand;