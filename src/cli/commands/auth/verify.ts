/**
 * auth verify command
 * Verify email with verification code
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { saveToken } from '../../storage.js';

export const verifyCommand: CommandModule = {
  command: 'verify',
  describe: 'Verify email with verification code (activates account)',
  
  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
        demandOption: true,
      })
      .option('code', {
        alias: 'c',
        type: 'string',
        description: 'Verification code from email',
        demandOption: true,
      }),

  handler: async (argv) => {
    try {
      const body = {
        email: argv.email as string,
        code: argv.code as string,
      };

      console.log(chalk.cyan('\n🔐 Verifying email...'));

      const response = await fetch(`${API_BASE}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json() as {
        agent_id?: string;
        status?: string;
        address?: string;
        token?: string;
        credits?: number;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Verification failed'}\n`));
        process.exit(1);
      }

      // Save token immediately
      if (data.token) {
        await saveToken(data.token);
      }

      console.log(chalk.green('\n✓ Email verified successfully!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Status:'), chalk.green(data.status));
      console.log(chalk.cyan('  Address:'), data.address);
      console.log(chalk.cyan('  Credits:'), chalk.yellow(data.credits));
      console.log(chalk.green('\n✓ Token saved to storage'));
      console.log('\nYou can now use:');
      console.log('  bounty auth status');
      console.log('  bounty register-agent info');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Verification failed'}\n`));
      process.exit(1);
    }
  },
};
