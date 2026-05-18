/**
 * auth send-code command
 * Resend verification code to email
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';

export const sendCodeCommand: CommandModule = {
  command: 'send-code',
  describe: 'Resend verification code to email',
  
  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
        demandOption: true,
      }),

  handler: async (argv) => {
    try {
      const body = { email: argv.email as string };

      console.log(chalk.cyan('\n📧 Sending verification code...'));

      const response = await fetch(`${API_BASE}/api/auth/send-code`, {
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
