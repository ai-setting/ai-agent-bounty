/**
 * agent credits command
 * Check agent credits and transaction history
 *
 * v0.7: prefer --agent-address (<uuid>@<host>); legacy --id remains
 * accepted and maps to local agent id lookup.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { resolveAgentIdOption } from '../../lib/address-parser.js';

interface CreditsOptions {
  'agent-address'?: string;
  /** @deprecated Use --agent-address. */
  id?: string;
  history?: number;
}

export const creditsCommand: CommandModule<object, CreditsOptions> = {
  command: 'credits',
  describe: 'Check agent credits and transaction history',

  builder: (yargs) =>
    yargs
      .option('agent-address', {
        alias: ['id', 'i'],
        type: 'string',
        demandOption: true,
        description: 'Agent address (<uuid>@<host>). Legacy --id / -i pure id is also accepted.',
      })
      .option('history', {
        alias: 'h',
        type: 'number',
        default: 10,
        description: 'Number of recent transactions to show',
      }),

  handler: async (argv) => {
    const options = argv as unknown as CreditsOptions & { id?: string };
    const ctx = createContext();

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
        ctx.db.close();
        process.exit(2);
      }

      const agent = ctx.agentService.getById(resolvedAgent.value);

      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const history = ctx.agentService.getCreditHistory(
        agent.id,
        options.history as number
      );

      console.log(chalk.bold('\nAgent Credits:\n'));
      console.log(chalk.cyan('  ID:'), agent.id);
      console.log(chalk.cyan('  Name:'), agent.name);
      console.log(chalk.green(`  Balance: ${agent.credits} credits\n`));

      if (history.length > 0) {
        console.log(chalk.bold('Recent Transactions:\n'));

        history.forEach((tx: any) => {
          const amount = tx.amount >= 0
            ? chalk.green(`+${tx.amount}`)
            : chalk.red(`${tx.amount}`);
          const type = tx.type === 'reward'
            ? chalk.green('[REWARD]')
            : tx.type === 'deduct'
              ? chalk.red('[DEDUCT]')
              : '[TRANSFER]';

          console.log(`  ${type} ${amount} - ${tx.description || 'No description'}`);
          console.log(chalk.gray(`    ${new Date(tx.created_at).toLocaleString()}`));
        });
        console.log();
      }

      ctx.db.close();
    } catch (error: any) {
      console.error(chalk.red('\n✗ Error:'), error.message);
      ctx.db.close();
      process.exit(1);
    }
  },
};
