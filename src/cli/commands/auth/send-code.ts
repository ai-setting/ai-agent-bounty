/**
 * Auth send-code command.
 *
 * PR3: 用 active profile 的 api_base 调用 /api/auth/send-code；无 token 写入
 * （接口只发邮件）。
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

export const sendCodeCommand: CommandModule = {
  command: 'send-code',
  describe: 'Resend verification code to email',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
        demandOption: true,
      })
    ),

  handler: async (argv) => {
    try {
      const body = { email: argv.email as string };

      console.log(chalk.cyan('\n📧 Sending verification code...'));

      const profile = ProfileContext.getActive();
      const baseUrl = resolveProfileApiBase({
        cliServerUrl: argv['server-url'] as string | undefined,
        fallbackApiBase: API_BASE,
        profile,
        resolveServerUrlFn: resolveServerUrl,
      });

      const response = await bountyFetch(`${baseUrl}/api/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json() as {
        message?: string;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Failed to send code'}\n`));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Verification code sent!'));
      if (profile) {
        console.log(chalk.cyan('  Profile:'), profile.name);
      }
      console.log(`  ${data.message || 'Please check your email'}`);
      console.log('\nNext step:');
      console.log('  bounty auth verify --email ' + argv.email + ' --code <code>');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to send code'}\n`));
      process.exit(1);
    }
  },
};

export default sendCodeCommand;