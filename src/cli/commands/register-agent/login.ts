/**
 * agent login command
 * Login to get auth token.
 *
 * v0.14 STRICT email-only:
 *   - Actor identity input is `--email / -e` ONLY.
 *   - `--agent-address / -a` (`<uuid>@<host>`) is REMOVED.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { saveToken } from '../../storage.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';
import {
  requireEmailFlag,
  exitWithEmailFlagError,
} from '../../lib/email-flag.js';

interface LoginOptions {
  email?: string;
  'server-url'?: string;
}

export const loginCommand: CommandModule<object, LoginOptions> = {
  command: 'login',
  describe: 'Login to get auth token (v0.14 STRICT: --email only).',

  builder: (yargs) =>
    addServerUrlOption(
      yargs.option('email', {
        alias: 'e',
        type: 'string',
        description:
          'Agent email (v0.14 ONLY input). <uuid>@<host> and bare UUIDs are REJECTED.',
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
      const body: { email: string } = { email };

      const baseUrl = resolveServerUrl(argv['server-url'], API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = (await response.json()) as {
        token?: string;
        agent_id?: string;
        email?: string;
        expires_in?: number;
        error?: string;
      };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${data.error || 'Login failed'}\n`));
        process.exit(1);
      }

      // Save token
      if (data.token) {
        await saveToken(data.token);
      }
      const expiresIn = data.expires_in ? Math.round(data.expires_in / 3600) : 24;

      console.log(chalk.green('\n✓ Login successful!'));
      console.log(chalk.cyan('  Agent ID:'), data.agent_id);
      console.log(chalk.cyan('  Email:'), data.email);
      console.log(`  Token saved. Expires in: ${expiresIn} hours`);
      console.log('\nYou can now use:');
      console.log('  bounty register-agent info');
      console.log('  bounty tasks list');
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Login failed'}\n`));
      process.exit(1);
    }
  },
};
