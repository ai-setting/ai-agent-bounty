/**
 * Com Commands
 * Communication commands using Agent IM (WebSocket + HTTP)
 */

import type { CommandModule } from 'yargs';
import { sendCommand } from './send.js';
import { addressesCommand } from './addresses.js';
import { inboxCommand } from './inbox.js';
import { connectCommand } from './connect.js';
import { disconnectCommand } from './disconnect.js';

export const comCommands: CommandModule = {
  command: 'com',
  describe: 'Communication commands (Agent IM)',
  
  builder: (yargs) =>
    yargs
      .command(sendCommand)
      .command(addressesCommand)
      .command(inboxCommand)
      .command(connectCommand)
      .command(disconnectCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler
  },
};

// Re-export individual commands for easier import
export { sendCommand } from './send.js';
export { addressesCommand } from './addresses.js';
export { inboxCommand } from './inbox.js';
export { connectCommand } from './connect.js';
export { disconnectCommand } from './disconnect.js';
