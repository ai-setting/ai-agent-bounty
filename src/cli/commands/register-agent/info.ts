/**
 * agent info command
 * Get detailed information about an agent
 *
 * v0.10 BREAKING: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { resolveAddressOption } from '../../lib/address-parser.js';

interface InfoOptions {
  'agent-address'?: string;
  email?: string;
}

export const infoCommand: CommandModule<object, InfoOptions> = {
  command: 'info',
  describe: 'Get detailed information about an agent',

  builder: (yargs) =>
    yargs
      .option('agent-address', {
        alias: 'a',
        type: 'string',
        description:
          'Agent address in <uuid>@<host> format (REQUIRED). ' +
          'Bare UUID is REJECTED in v0.10.',
      })
      .option('email', {
        alias: 'e',
        type: 'string',
        description: 'Agent email',
      }),

  handler: async (argv) => {
    const options = argv as unknown as InfoOptions;
    const ctx = createContext();

    try {
      const resolvedAgent = options['agent-address']
        ? resolveAddressOption({
            address: options['agent-address'],
            addressFlag: '--agent-address',
            missingMessage: '✗ --agent-address is required (<uuid>@<host> format)',
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
        ? ctx.agentService.findByAddress(resolvedAgent.value.raw)
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
