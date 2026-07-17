/**
 * agent get command
 * Get details of a specific agent by uuid
 *
 * v0.10: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 *   Server path uses bare uuid (server looks up by `agents.id`).
 *
 * v0.13: --email is now the PRIMARY lookup key (server resolves via
 *   agents.email UNIQUE column); --agent-address remains as a backward-
 *   compatible secondary option. At least one is required.
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

interface GetAgentOptions {
  'agent-address'?: string;
  email?: string;
  'server-url'?: string;
}

interface Agent {
  id: string;
  name: string;
  email: string;
  status: string;
  credits: number;
  address?: string;
  description?: string;
  created_at: number;
}

export const getCommand: CommandModule<object, GetAgentOptions> = {
  command: 'get',
  describe: 'Get details of a specific agent by uuid or email (v0.13 email-first)',

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
        .check((argv) => {
          if (!argv.email && !argv['agent-address']) {
            throw new Error('Either --email or --agent-address is required (v0.13 email-first).');
          }
          return true;
        })
    ),

  handler: async (argv) => {
    const options = argv as unknown as GetAgentOptions;

    try {
      let agentUuid: string | null = null;
      let resolvedAgent: ReturnType<typeof resolveAddressOption> | undefined;
      if (options.email) {
        // v0.13: server will resolve email → agent.id when we POST/PUT, but
        // for GET /api/agents/:id we still need the UUID. We send a query
        // param hint (email=) and let the server try lookup; if the server
        // cannot resolve, fall back to a 400 telling the caller to use
        // /api/agents?email=<email> instead.
        agentUuid = '__resolve_by_email__'; // sentinel; replaced below
      } else if (options['agent-address']) {
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

      const baseUrl = resolveServerUrl(options['server-url'], API_BASE);
      const auth = attachSoftAuth({});

      // v0.13: when an email is supplied, the server now supports
      // GET /api/agents/by-email?email=<email> (added in v0.13).
      // For --agent-address we keep the legacy /api/agents/:uuid path.
      const url = options.email
        ? `${baseUrl}/api/agents/by-email?email=${encodeURIComponent(options.email)}`
        : `${baseUrl}/api/agents/${agentUuid}`;

      const response = await bountyFetch(url, {
        method: 'GET',
        headers: auth.headers,
      });

      if (response.status === 401) {
        // Server may still require auth for some deployments.
        console.log(chalk.yellow('\n⚠ Unauthorized. Please login if this endpoint requires a token.\n'));
        process.exit(1);
      }

      const data = (await response.json()) as Agent | Agent[] | { error: string };

      if (!response.ok) {
        console.error(chalk.red(`\n✗ Error: ${(data as { error: string }).error || 'Failed to get agent'}\n`));
        process.exit(1);
      }

      let agent: Agent;
      if (options.email) {
        const list = (Array.isArray(data) ? data : []) as Agent[];
        if (list.length === 0) {
          console.error(chalk.red(`\n✗ Error: no agent found for email ${options.email}\n`));
          process.exit(1);
        }
        agent = list[0];
      } else {
        agent = data as Agent;
      }

      console.log(chalk.bold('\nAgent Details:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(chalk.cyan('  Credits:'), agent.credits);
      if (agent.address) {
        console.log(chalk.cyan('  Address:'), agent.address);
      }
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Created:'), new Date(agent.created_at).toLocaleString());
      console.log();
    } catch (error) {
      console.error(chalk.red(`\n✗ Error: ${error instanceof Error ? error.message : 'Failed to get agent'}\n`));
      process.exit(1);
    }
  },
};
