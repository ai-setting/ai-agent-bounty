/**
 * IM CLI - Health Check Command
 */

import type { CommandModule } from 'yargs';

interface HealthOptions {
  host?: string;
  port?: number;
}

export const HealthCommand: CommandModule<object, HealthOptions> = {
  command: ['health', 'h'],
  describe: 'Check IM server health status',
  builder: (yargs) =>
    yargs
      .option('host', {
        alias: 'H',
        type: 'string',
        description: 'Server host',
        default: 'localhost',
      })
      .option('port', {
        alias: 'p',
        type: 'number',
        description: 'Server port',
        default: 8080,
      }),
  handler: async (args) => {
    const { host, port } = args;
    const url = `http://${host}:${port}/health`;
    
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        console.log('✓ Server is healthy');
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.error(`✗ Server returned status ${response.status}`);
        process.exit(1);
      }
    } catch (error) {
      console.error(`✗ Cannot connect to server at ${url}`);
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};
