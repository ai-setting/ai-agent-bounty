/**
 * agent add command
 * Register a new agent in the bounty system (via API)
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';

interface AddAgentOptions {
  email: string;
  name: string;
  description?: string;
}

export const addCommand: CommandModule = {
  command: 'add',
  describe: 'Register a new agent (requires email verification)',

  builder: (yargs) =>
    yargs
      .option('email', {
        alias: 'e',
        type: 'string',
        demandOption: true,
        description: 'Agent email address',
      })
      .option('name', {
        alias: 'n',
        type: 'string',
        demandOption: true,
        description: 'Agent name',
      })
      .option('description', {
        alias: 'd',
        type: 'string',
        description: 'Agent description (optional)',
      }),

  handler: async (argv) => {
    const options = argv as unknown as AddAgentOptions;

    try {
      const response = await fetch(`${API_BASE}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: options.email,
          name: options.name,
          description: options.description,
        }),
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
      console.log(chalk.cyan('  Email:'), options.email);
      console.log('\n' + (data.message || ''));
      console.log('\nNext: Check your email and verify with:');
      console.log(chalk.cyan(`  bounty register-agent verify --email ${options.email} --code <code>`));
      console.log();
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Registration failed'}\n`));
      process.exit(1);
    }
  },
};
