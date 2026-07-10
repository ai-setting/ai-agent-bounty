/**
 * agent delete command
 * Delete an agent by address
 *
 * v0.7: prefer --agent-address (<uuid>@<host>); legacy --id remains
 * accepted and is translated to the server's agent id path segment.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface DeleteAgentOptions {
  'agent-address'?: string;
  /** @deprecated Use --agent-address. */
  id?: string;
  force?: boolean;
  'server-url'?: string;
}

export const deleteCommand: CommandModule<object, DeleteAgentOptions> = {
  command: 'delete',
  describe: 'Delete an agent by address',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description: 'Agent address (<uuid>@<host>). Pure <uuid> is also accepted.',
        })
        .option('id', {
          alias: 'i',
          type: 'string',
          description: '[deprecated] Agent ID to delete. Use --agent-address instead.',
        })
        .option('force', {
          alias: 'f',
          type: 'boolean',
          default: false,
          description: 'Skip confirmation prompt',
        })
    ),

  handler: async (argv) => {
    const options = argv as unknown as DeleteAgentOptions & { id?: string };

    try {
      const resolvedAgent = resolveAgentIdOption({
        address: options['agent-address'],
        deprecatedId: options.id,
        addressFlag: '--agent-address',
        deprecatedFlag: '--id',
        missingMessage: '✗ --agent-address is required',
      });
      if (!resolvedAgent.ok) {
        console.error(chalk.red(`\n${resolvedAgent.error}\n`));
        process.exit(2);
      }
      options.id = resolvedAgent.value;

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
      const auth = attachSoftAuth({});

      const response = await bountyFetch(`${baseUrl}/api/agents/${options.id}`, {
        method: 'DELETE',
        headers: auth.headers,
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
