/**
 * com config command
 * Configure Agent IM server connection
 */

import type { CommandModule } from 'yargs';
import chalk from 'chalk';
import { CLI_PORT } from '../../config-env.js';

interface ConfigOptions {
  host?: string;
  port?: number;
  show?: boolean;
}

export const configCommand: CommandModule<object, ConfigOptions> = {
  command: ['config', 'c'],
  describe: 'Configure Agent IM server connection',
  
  builder: (yargs) =>
    yargs
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'IM server host (default: localhost)',
        default: 'localhost',
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'IM server port (default: from BOUNTY_PORT)',
        default: parseInt(CLI_PORT, 10),
      })
      .option('show', {
        alias: 's',
        type: 'boolean',
        description: 'Show current configuration',
        default: false,
      }),

  handler: async (args) => {
    const { host, port } = args;
    
    // Save config to local file
    const config = {
      imHost: host,
      imPort: port,
      updatedAt: new Date().toISOString(),
    };
    
    try {
      // In a real implementation, this would save to a config file
      // For now, we just show the config
      console.log(chalk.green('\n✓ Agent IM configuration\n'));
      console.log(chalk.bold('Current Configuration:\n'));
      console.log(chalk.cyan('  Server Host:'), config.imHost);
      console.log(chalk.cyan('  Server Port:'), config.imPort, chalk.gray('(from BOUNTY_PORT)'));
      console.log(chalk.gray(`  Updated: ${config.updatedAt}`));
      console.log();
      
      // Verify connection
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
    } catch (error) {
      console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
