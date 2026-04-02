/**
 * Bounty Commands
 * Commands for managing bounty tasks
 */

import type { CommandModule } from 'yargs';
import { publishCommand } from './publish.js';
import { boardCommand } from './board.js';
import { grabCommand } from './grab.js';
import { submitCommand } from './submit.js';
import { completeCommand } from './complete.js';
import { cancelCommand } from './cancel.js';

export const bountyCommands: CommandModule = {
  command: 'bounty',
  describe: 'Manage bounty tasks',
  
  builder: (yargs) =>
    yargs
      .command(publishCommand)
      .command(boardCommand)
      .command(grabCommand)
      .command(submitCommand)
      .command(completeCommand)
      .command(cancelCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler
  },
};
