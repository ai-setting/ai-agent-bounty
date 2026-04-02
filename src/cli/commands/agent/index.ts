/**
 * Agent Commands
 * Commands for managing agents in the bounty system
 */

import type { CommandModule } from 'yargs';
import { registerCommand } from './register.js';
import { listCommand } from './list.js';
import { infoCommand } from './info.js';
import { creditsCommand } from './credits.js';

export const agentCommands: CommandModule = {
  command: 'agent',
  describe: 'Manage agents in the bounty system',
  
  builder: (yargs) =>
    yargs
      .command(registerCommand)
      .command(listCommand)
      .command(infoCommand)
      .command(creditsCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler, should not be reached
    // since we use demandCommand(1)
  },
};
