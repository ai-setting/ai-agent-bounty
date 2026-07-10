/**
 * agent login command
 * Login to get auth token
 *
 * v0.7: prefer address-based agent identity (--agent-address). Legacy
 * --agent-id remains accepted for backward compatibility.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { API_BASE } from '../../config.js';
import { saveToken } from '../../storage.js';
// v0.5.0: TLS skip default — use bountyFetch wrapper
import { bountyFetch } from '../../lib/fetch-helper.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';

import {
  addServerUrlOption,
  resolveServerUrl,
} from '../../lib/server-url-option.js';

interface LoginOptions {
  email?: string;
  'agent-address'?: string;
  /** @deprecated Use --agent-address. */
  'agent-id'?: string;
  'server-url'?: string;
}

export const loginCommand: CommandModule<object, LoginOptions> = {
  command: 'login',
  describe: 'Login to get auth token',

  builder: (yargs) =>
    addServerUrlOption(
      yargs
        .option('email', {
          alias: 'e',
          type: 'string',
          description: 'Agent email',
        })
        .option('agent-address', {
          alias: 'a',
          type: 'string',
          description: 'Agent address (<uuid>@<host>). Pure <uuid> is also accepted.',
        })
        .option('agent-id', {
          type: 'string',
          description: '[deprecated] Agent ID. Use --agent-address instead.',
        })
    ),

  handler: async (argv) => {
    if (!argv.email && !argv['agent-address'] && !argv['agent-id']) {
      console.error(chalk.red('\n✗ Error: --email or --agent-address is required\n'));
      console.error('Usage: bounty register-agent login --agent-address <uuid>@<host>');
      process.exit(1);
    }

    const resolvedAgent = (argv['agent-address'] || argv['agent-id'])
      ? resolveAgentIdOption({
          address: argv['agent-address'],
          deprecatedId: argv['agent-id'],
          addressFlag: '--agent-address',
          deprecatedFlag: '--agent-id',
        })
      : undefined;

    if (resolvedAgent && !resolvedAgent.ok) {
      console.error(chalk.red(`\n${resolvedAgent.error}\n`));
      process.exit(2);
    }

    try {
      const body: { email?: string; agent_id?: string } = {};
      if (argv.email) body.email = argv.email;
      if (resolvedAgent?.ok) body.agent_id = resolvedAgent.value;

      const baseUrl = resolveServerUrl(argv['server-url'], API_BASE);

      const response = await bountyFetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json() as {
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
