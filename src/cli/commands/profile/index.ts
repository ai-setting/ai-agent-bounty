/**
 * Profile Commands
 *
 * PR2: Compose the six profile-management commands under a single `profile`
 * parent command. Each child lives in its own file so test isolation and
 * incremental delivery stay simple. The parent itself is just glue — no
 * I/O happens here.
 */

import type { CommandModule } from 'yargs';
import { addCommand } from './add.js';
import { listCommand } from './list.js';
import { showCommand } from './show.js';
import { useCommand } from './use.js';
import { removeCommand } from './remove.js';
import { renameCommand } from './rename.js';

export const profileCommands: CommandModule = {
  command: 'profile',
  describe: 'Manage bounty profiles (add/list/show/use/remove/rename)',

  builder: (yargs) =>
    yargs
      .command(addCommand)
      .command(listCommand)
      .command(showCommand)
      .command(useCommand)
      .command(removeCommand)
      .command(renameCommand)
      .demandCommand(1, 'See `bounty profile --help` for available commands')
      .help(),

  handler: () => {
    // Parent handler is a no-op; demandCommand(1) prevents direct invocation.
  },
};

// Re-export individual commands for testing and for callers that import
// specific commands directly.
export { addCommand } from './add.js';
export { listCommand } from './list.js';
export { showCommand } from './show.js';
export { useCommand } from './use.js';
export { removeCommand } from './remove.js';
export { renameCommand } from './rename.js';
