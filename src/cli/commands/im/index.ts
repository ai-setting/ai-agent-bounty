/**
 * IM CLI Commands Index
 */

import type { CommandModule } from 'yargs';
import { HealthCommand } from './health.js';
import { SendCommand } from './send.js';
import { InboxCommand } from './inbox.js';

export const imCommands: CommandModule = {
  command: 'im',
  describe: 'Agent IM (Instant Messaging) commands',
  builder: (yargs) => yargs
    .command(HealthCommand)
    .command(SendCommand)
    .command(InboxCommand)
    .demandCommand(1, 'See --help for available commands'),
  handler: () => {},
};
