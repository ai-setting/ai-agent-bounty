/**
 * agent credits command
 * Check agent credits and transaction history
 *
 * v0.10 BREAKING: --id / -i REMOVED. Use --agent-address <uuid>@<host>.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';
import { resolveAddressOption } from '../../lib/address-parser.js';

interface CreditsOptions {
  'agent-address'?: string;
  history?: number;
}

export const creditsCommand: CommandModule<object, CreditsOptions> = {
  command: 'credits',
  describe: 'Check agent credits and transaction history',

  builder: (yargs) =>
    yargs
      .option('agent-address', {
        alias: 'a',
        type: 'string',
        demandOption: true,
        description:
          'Agent address in <uuid>@<host> format (REQUIRED). ' +
          'Bare UUID is REJECTED in v0.10.',
      })
      .option('history', {
        alias: 'h',
        type: 'number',
        default: 10,
        description: 'Number of recent transactions to show',
      }),

  handler: async (argv) => {
    const options = argv as unknown as CreditsOptions;
    const ctx = createContext();

    try {
      const resolvedAgent = resolveAddressOption({
        address: options['agent-address'],
        addressFlag: '--agent-address',
        missingMessage: '✗ --agent-address is required (<uuid>@<host> format)',
      });

      if (!resolvedAgent.ok) {
        console.error(chalk.red(`\n${resolvedAgent.error}\n`));
        ctx.db.close();
        process.exit(2);
      }

      // v0.10: resolve via full address → look up agent
      const agent = ctx.agentService.findByAddress(resolvedAgent.value.raw);

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
