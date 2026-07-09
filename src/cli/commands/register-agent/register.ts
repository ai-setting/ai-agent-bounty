/**
 * agent register command
 * Register a new agent in the bounty system
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

export const registerCommand: CommandModule = {
  command: 'register',
  describe: 'Register a new agent in the bounty system',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('name', {
          alias: 'n',
          type: 'string',
          demandOption: true,
          description: 'Agent name',
        })
        .option('email', {
          alias: 'e',
          type: 'string',
          demandOption: true,
          description: 'Agent email',
        })
        .option('description', {
          alias: 'd',
          type: 'string',
          description: 'Agent description (optional)',
        })
    ),

  handler: async (argv) => {
    try {
      const baseUrl = resolveServerUrl(argv['server-url'] as string | undefined, API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: argv.email,
          name: argv.name,
          description: argv.description
        })
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
      console.log('\n' + (data.message || ''));
      console.log('\nNext: Check your email and verify with:');
      console.log(chalk.cyan(`  bounty register-agent verify --email ${argv.email} --code <code>`));
      console.log();
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Registration failed'}\n`));
      process.exit(1);
    }
  },
};
