/**
 * agent credits command
 * Check agent credits and transaction history
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { createContext } from '../../services/context.js';

export const creditsCommand: CommandModule = {
  command: 'credits',
  describe: 'Check agent credits and transaction history',
  
  builder: (yargs) =>
    yargs
      .option('id', {
        alias: 'i',
        type: 'string',
        demandOption: true,
        description: 'Agent ID',
      })
      .option('history', {
        alias: 'h',
        type: 'number',
        default: 10,
        description: 'Number of recent transactions to show',
      }),

  handler: async (argv) => {
    const ctx = createContext();

    try {
      const agent = ctx.agentService.getById(argv.id as string);

      if (!agent) {
        console.error(chalk.red('\n✗ Error: Agent not found\n'));
        ctx.db.close();
        process.exit(1);
      }

      const history = ctx.agentService.getCreditHistory(
        agent.id,
        argv.history as number
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
