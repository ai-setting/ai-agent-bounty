/**
 * auth send-code command
 * Resend verification code to email
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 通过 addServerUrlOption helper 复用 --server-url / -u 选项
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

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

      const baseUrl = resolveServerUrl(argv['server-url'] as string | undefined, API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/auth/send-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
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
      console.log(`  ${data.message || 'Please check your email'}`);
      console.log('\nNext step:');
      console.log('  bounty auth verify --email ' + argv.email + ' --code <code>');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to send code'}\n`));
      process.exit(1);
    }
  },
};
