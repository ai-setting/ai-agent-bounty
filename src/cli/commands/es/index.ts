/**
 * Bounty Event Source Commands
 */

import type { CommandModule } from 'yargs';
import { esList, esAdd, esStart, esStop, esRemove } from './bounty.js';

/**
 * bounty es (list) - 默认命令
 */
export const EsListCommand: CommandModule = {
  command: '$0',
  describe: 'List bounty-im event sources',
  handler: () => esList(),
};

/**
 * bounty es add --address <address>
 */
export const EsAddCommand: CommandModule = {
  command: 'add',
  describe: 'Add a bounty-im event source',
  builder: (yargs) =>
    yargs
      .option('name', { type: 'string', description: 'Event source name' })
      .option('address', { 
        alias: 'a', 
        type: 'string', 
        demandOption: true,
        description: 'Agent address (format: agent-id@host)',
      })
      .option('url', { 
        alias: 'u', 
        type: 'string', 
        description: 'IM server WebSocket URL',
        default: 'ws://localhost:3001/ws',
      }),
  handler: (args) => {
    esAdd({
      name: args.name as string | undefined,
      address: args.address as string,
      url: args.url as string | undefined,
    });
  },
};

/**
 * bounty es start <id>
 */
export const EsStartCommand: CommandModule = {
  command: 'start <id>',
  describe: 'Start an event source',
  handler: (args) => {
    esStart(args.id as string);
  },
};

/**
 * bounty es stop <id>
 */
export const EsStopCommand: CommandModule = {
  command: 'stop <id>',
  describe: 'Stop an event source',
  handler: (args) => {
    esStop(args.id as string);
  },
};

/**
 * bounty es remove <id>
 */
export const EsRemoveCommand: CommandModule = {
  command: 'remove <id>',
  describe: 'Remove an event source',
  aliases: ['rm'],
  handler: (args) => {
    esRemove(args.id as string);
  },
};

/**
 * Bounty Event Source Parent Command
 */
export const bountyEsCommands: CommandModule = {
  command: 'es',
  describe: 'Bounty event source commands',
  builder: (yargs) =>
    yargs
      .command(EsListCommand)
      .command(EsAddCommand)
      .command(EsStartCommand)
      .command(EsStopCommand)
      .command(EsRemoveCommand)
      .demandCommand(1, 'See --help for available commands'),
  handler: () => {},
};
