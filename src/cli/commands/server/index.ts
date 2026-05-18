/**
 * Server Commands
 * Commands for managing the bounty server
 * 
 * Provides server management commands:
 * - server start - Start the bounty server
 * - server stop - Stop the bounty server
 * - server status - Show server status
 * - server config - Show server configuration
 * 
 * Note: All CLI commands require the server to be running.
 * Use `bounty server start` to start the server.
 */

import type { CommandModule } from 'yargs';
import { startCommand } from './start.js';
import { stopCommand } from './stop.js';
import { statusCommand } from './status.js';
import { configCommand } from './config.js';

export const serverCommands: CommandModule = {
  command: 'server',
  describe: 'Manage bounty server (start, stop, status, config)',
  
  builder: (yargs) =>
    yargs
      .command(startCommand)
      .command(stopCommand)
      .command(statusCommand)
      .command(configCommand)
      .demandCommand(1, 'See --help for available commands'),

  handler: () => {
    // This is the parent command handler, should not be reached
    // since we use demandCommand(1)
  },
};
