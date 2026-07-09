/**
 * agent delete command
 * Delete an agent by ID
 *
 * Phase feat/bounty-all-commands-server-url:
 * - 通过 addServerUrlOption helper 复用 --server-url / -u 选项
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { loadToken } from '../../storage.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface DeleteAgentOptions {
  id: string;
  force?: boolean;
  'server-url'?: string;
}

export const deleteCommand: CommandModule = {
  command: 'delete',
  describe: 'Delete an agent by ID',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('id', {
          alias: 'i',
          type: 'string',
          demandOption: true,
          description: 'Agent ID to delete',
        })
        .option('force', {
          alias: 'f',
          type: 'boolean',
          default: false,
          description: 'Skip confirmation prompt',
        })
    ),

  handler: async (argv) => {
    const options = argv as unknown as DeleteAgentOptions;

    try {
      // Load token
      const token = await loadToken();

      if (!token) {
        console.log(chalk.yellow('\n⚠ No token found. Please login first.\n'));
        console.log(chalk.cyan('  bounty register-agent login --email <your-email>\n'));
        process.exit(1);
      }

      // Confirm deletion unless --force
      if (!options.force) {
        console.log(chalk.yellow(`\n⚠ You are about to delete agent ${options.id}`));
        console.log('Type "yes" to confirm: ');

        const rl = await import('readline');
        const iface = rl.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const answer = await new Promise<string>((resolve) => {
          iface.question('', resolve);
        });
        iface.close();

        if (answer.toLowerCase() !== 'yes') {
          console.log(chalk.yellow('\n✗ Deletion cancelled.\n'));
          return;
        }
      }

      const baseUrl = resolveServerUrl(options['server-url'], API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/agents/${options.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json() as { message?: string; error?: string };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Failed to delete agent'}\n`));
        process.exit(1);
      }

      console.log(chalk.green('\n✓ Agent deleted successfully!\n'));
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to delete agent'}\n`));
      process.exit(1);
    }
  },
};
