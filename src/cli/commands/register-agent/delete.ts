/**
 * agent delete command
 * Delete an agent by uuid
 *
 * v0.10 BREAKING: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 * Server path uses bare uuid (server looks up by `agents.id`).
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';
import { resolveAddressOption } from '../../lib/address-parser.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface DeleteAgentOptions {
  'agent-address'?: string;
  force?: boolean;
  'server-url'?: string;
}

export const deleteCommand: CommandModule<object, DeleteAgentOptions> = {
  command: 'delete',
  describe: 'Delete an agent by uuid',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format (REQUIRED). ' +
            'Bare UUID is REJECTED in v0.10.',
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
      const resolvedAgent = resolveAddressOption({
        address: options['agent-address'],
        addressFlag: '--agent-address',
        missingMessage: '✗ --agent-address is required (<uuid>@<host> format)',
      });
      if (!resolvedAgent.ok) {
        console.error(chalk.red(`\n${resolvedAgent.error}\n`));
        process.exit(2);
      }
      const agentUuid = resolvedAgent.value.uuid;

      // Confirm deletion unless --force
      if (!options.force) {
        console.log(chalk.yellow(`\n⚠ You are about to delete agent ${agentUuid}`));
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

      const response = await bountyFetch(`${baseUrl}/api/agents/${agentUuid}`, {
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
