/**
 * Com Commands
 * Communication commands for email operations
 */

import type { CommandModule } from 'yargs';
import { sendCommand } from './send.js';
import { configCommand } from './config.js';
import { addressesCommand } from './addresses.js';
import { inboxCommand } from './inbox.js';

export const comCommands: CommandModule = {
  command: 'com',
  describe: 'Communication commands (email)',
  
  builder: (yargs) =>
    yargs
      .command(sendCommand)
      .command(configCommand)
      .command(addressesCommand)
      .command(inboxCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler
  },
};

// Re-export individual commands for easier import
export { sendCommand } from './send.js';
export { configCommand } from './config.js';
export { addressesCommand } from './addresses.js';
export { inboxCommand } from './inbox.js';
