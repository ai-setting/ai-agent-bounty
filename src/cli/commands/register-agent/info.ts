/**
 * agent info command
 * Get detailed information about an agent
 *
 * v0.7: prefer --agent-address (<uuid>@<host>); legacy --id remains
 * accepted and maps to local agent id lookup.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';

interface InfoOptions {
  'agent-address'?: string;
  /** @deprecated Use --agent-address. */
  id?: string;
  email?: string;
}

export const infoCommand: CommandModule<object, InfoOptions> = {
  command: 'info',
  describe: 'Get detailed information about an agent',

  builder: (yargs) =>
    yargs
      .option('agent-address', {
        alias: ['id', 'i'],
        type: 'string',
        description: 'Agent address (<uuid>@<host>). Legacy --id / -i pure id is also accepted.',
      })
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
      }),

  handler: async (argv) => {
    const options = argv as unknown as InfoOptions & { id?: string };
    const ctx = createContext();

    try {
      const resolvedAgent = (options['agent-address'] || options.id)
        ? resolveAgentIdOption({
            address: options['agent-address'],
            deprecatedId: options.id,
            addressFlag: '--agent-address',
            deprecatedFlag: '--id',
          })
        : undefined;

      if (resolvedAgent && !resolvedAgent.ok) {
        console.error(chalk.red(`\n${resolvedAgent.error}\n`));
        ctx.db.close();
        process.exit(2);
      }

      if (!resolvedAgent?.ok && !options.email) {
        console.error(chalk.red('\n✗ Error: --agent-address or --email is required\n'));
        ctx.db.close();
        process.exit(1);
      }

      const agent = resolvedAgent?.ok
        ? ctx.agentService.getById(resolvedAgent.value)
        : ctx.agentService.getByEmail(options.email as string);

      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      console.log(chalk.bold('\nAgent Info:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.cyan('  Email:'), agent.email);
      if (agent.description) {
        console.log(chalk.cyan('  Description:'), agent.description);
      }
      console.log(chalk.cyan('  Credits:'), agent.credits);
      console.log(chalk.cyan('  Status:'), agent.status);
      console.log(
        chalk.cyan('  Created:'),
        new Date(agent.createdAt).toLocaleString()
      );
      console.log();

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
