/**
 * agent delete command
 * Delete an agent by uuid
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 *   Server path uses bare uuid (server looks up by `agents.id`).
 *
 * v0.13: --email is the PRIMARY lookup key (server resolves via
 *   agents.email UNIQUE column); --agent-address remains as a
 *   backward-compatible secondary option. At least one is required.
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
  email?: string;
  force?: boolean;
  'server-url'?: string;
}

export const deleteCommand: CommandModule<object, DeleteAgentOptions> = {
  command: 'delete',
  describe: 'Delete an agent by uuid or email (v0.13 email-first)',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'Agent email (v0.13 primary; preferred over --agent-address)',
        })
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description:
            'Agent address in <uuid>@<host> format [LEGACY: prefer --email in v0.13]. ' +
            'Bare UUID is REJECTED in v0.10.',
        })
        .option('force', {
          alias: 'f',
          type: 'boolean',
          default: false,
          description: 'Skip confirmation prompt',
        })
        .check((argv) => {
          if (!argv.email && !argv['agent-address']) {
            throw new Error('Either --email or --agent-address is required (v0.13 email-first).');
          }
          return true;
        })
    ),

  handler: async (argv) => {
    const options = argv as unknown as DeleteAgentOptions;

    try {
      // v0.13: when email supplied, we look up the uuid locally first via
      // a list-style GET; for the simple delete-by-id API, ask the server
      // to resolve via DELETE /api/agents/by-email?email=<email> (a v0.13
      // addition). If only --agent-address is given, parse it like v0.10.
      let agentUuid: string | null = null;
      let resolvedAgent: ReturnType<typeof resolveAddressOption> | undefined;

      if (options['agent-address']) {
        resolvedAgent = resolveAddressOption({
          address: options['agent-address'],
          addressFlag: '--agent-address',
          missingMessage: '✗ --agent-address is required (<uuid>@<host> format)',
        });
        if (!resolvedAgent.ok) {
          console.error(chalk.red(`\n${resolvedAgent.error}\n`));
          process.exit(2);
        }
        agentUuid = resolvedAgent.value.uuid;
      }

      // Confirm deletion unless --force
      const targetLabel = options.email ? options.email : agentUuid;
      if (!options.force) {
        console.log(chalk.yellow(`\n⚠ You are about to delete agent ${targetLabel}`));
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

      // v0.13: when an email is supplied the server resolves via DELETE
      // /api/agents/by-email?email=<email>. With --agent-address we use the
      // legacy /api/agents/:uuid path.
      const url = options.email
        ? `${baseUrl}/api/agents/by-email?email=${encodeURIComponent(options.email)}`
        : `${baseUrl}/api/agents/${agentUuid}`;

      const response = await bountyFetch(url, {
        method: 'DELETE',
        headers: auth.headers,
      });

      const data = (await response.json()) as { message?: string; error?: string };

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
