/**
 * @fileoverview Bounty CLI Main Entry
 * 继承 roy-agent CLI 命令并扩展 bounty 特有命令
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { createContext } from './services/context.js';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';

// 从 roy-agent-cli 导入命令
import { ActCommand } from '@gddzhaokun/roy-agent-cli';

// 导入 bounty 特有命令
import { agentCommands } from './commands/agent/index.js';
import { bountyCommands } from './commands/bounty/index.js';
import { comCommands } from './commands/com/index.js';

/**
 * Get package.json version
 */
function getVersion(): string {
  try {
    // package.json is in project root, go up one level from src/cli/
    const pkgPath = join(process.cwd(), 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    return pkg.version;
  } catch {
    return '0.1.0';
  }
}

export async function runBountyCli(): Promise<void> {
  const version = getVersion();

  await yargs(hideBin(process.argv))
    .scriptName('bounty')
    .version(version)
    .usage('$0 <command> [options]')
    .describe('h', 'show help')
    .alias('h', 'help')

    // 继承 roy-agent 命令
    .command(ActCommand)

    // 添加 bounty 特有命令
    .command(agentCommands)
    .command(bountyCommands)
    .command(comCommands)

    .demandCommand(1, 'See --help for available commands')
    .strict()
    .parse();
}
