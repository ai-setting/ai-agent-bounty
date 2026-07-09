/**
 * agent verify command
 * Verify email after registration
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

export const verifyCommand: CommandModule = {
  command: 'verify',
  describe: 'Verify email after registration',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          demandOption: true,
          description: 'Agent email',
        })
        .option('code', {
          alias: 'c',
          type: 'string',
          demandOption: true,
          description: 'Verification code',
        })
    ),

  handler: async (argv) => {
    try {
      const baseUrl = resolveServerUrl(argv['server-url'] as string | undefined, API_BASE);

      const response = await fetch(`${baseUrl}/api/auth/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: argv.email,
          code: argv.code
        })
      });

      const data = await response.json() as { 
        agent_id?: string; 
        address?: string; 
        credits?: number;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Verification failed'}\n`));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Email verified successfully!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Address:'), data.address);
      console.log(chalk.cyan('  Credits:'), data.credits);
      console.log('\nYou can now use:');
      console.log('  bounty register-agent info');
      console.log('  bounty tasks list');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Verification failed'}\n`));
      process.exit(1);
    }
  },
};
