/**
 * agent delete command — v0.14 STRICT email-only.
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 * v0.13: --email introduced as PRIMARY lookup; --agent-address retained.
 * v0.14 BREAKING:
 *   - --agent-address / -a REMOVED.
 *   - --email / -e is the ONLY actor identity input.
 *   - <uuid>@<host>, bare UUIDs, malformed emails REJECTED with exit 1.
 *   - Falls back to active profile's email when no explicit flag.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { bountyFetch } from '../../lib/fetch-helper.js';
import { attachSoftAuth } from '../../lib/soft-auth.js';
import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface DeleteAgentOptions {
  email?: string;
  force?: boolean;
  'server-url'?: string;
}

export const deleteCommand: CommandModule<object, DeleteAgentOptions> = {
  command: 'delete',
  describe: 'Delete an agent by email (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description:
            'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs REJECTED.',
        })
        .option('force', {
          alias: 'f',
          type: 'boolean',
          default: false,
          description: 'Skip confirmation prompt',
        })
    ),

  handler: async (argv) => {
    const parsed = requireEmailFlag(
      'email',
      argv as Record<string, unknown>,
    );
    if (!parsed.ok) {
      exitWithEmailFlagError(parsed);
    }
    const email = parsed.value;

    try {
      // Confirm deletion unless --force
      if (!argv.force) {
        console.log(chalk.yellow(`\n⚠ You are about to delete agent ${email}`));
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

      const baseUrl = resolveServerUrl(
        argv['server-url'] as string | undefined,
        API_BASE,
      );
      const auth = attachSoftAuth({});

      // v0.14: lookup is exclusively via /api/agents/by-email?email=<email>.
      const url = `${baseUrl}/api/agents/by-email?email=${encodeURIComponent(email)}`;

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
