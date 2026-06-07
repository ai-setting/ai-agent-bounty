/**
 * com config command
 *
 * STUB: this command does not write a config file. It only
 * displays the resolved host/port and probes the server. The
 * placeholder notice is printed so operators do not assume the
 * configuration has been persisted.
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { bountyConfig } from '../../../lib/config/bounty-config.js';
import { printStubNotice } from './stub.js';

interface ConfigOptions {
  host?: string;
  port?: number;
  show?: boolean;
}

export const configCommand: CommandModule<object, ConfigOptions> = {
  command: ['config', 'c'],
  describe: 'Display current IM configuration (placeholder, nothing is saved)',

  builder: (yargs) =>
    yargs
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host',
        default: bountyConfig.host,
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port',
        default: bountyConfig.port,
      })
      .option('show', {
        alias: 's',
        type: 'boolean',
        description: 'Show current configuration',
        default: false,
      }),

  handler: async (args) => {
    const { host, port, show } = args;

    console.log(chalk.green('\n✓ Agent IM configuration (read-only)\n'));
    console.log(chalk.bold('Current Configuration:\n'));
    console.log(chalk.cyan('  Server Host:'), host);
    console.log(chalk.cyan('  Server Port:'), port);
    console.log(chalk.cyan('  Server URL:'), `http://${host}:${port}`);
    console.log(chalk.cyan('  WebSocket URL:'), `ws://${host}:${port}/ws`);
    console.log();

    try {
      const response = await fetch(`http://${host}:${port}/health`);
      if (response.ok) {
        console.log(chalk.green('  Status:'), chalk.green('Connected'));
      } else {
        console.log(chalk.yellow('  Status:'), chalk.yellow('Server returned error'));
      }
    } catch {
      console.log(chalk.yellow('  Status:'), chalk.yellow('Not connected (server unreachable)'));
    }
    console.log();

    printStubNotice('config', { host, port, show });
  },
};
