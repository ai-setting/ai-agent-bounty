/**
 * Bounty IM Event Source CLI Commands
 */

import chalk from 'chalk';
import { 
  BountyIMEventSourceManager, 
  BountyIMConfig,
  validateBountyIMConfig,
  type BountyIMEvent 
} from '../../../im/eventsource/index.js';

// 全局管理器实例
const manager = new BountyIMEventSourceManager();

function generateId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 11);
  return `id_${timestamp}_${random}`;
}

const CONFIG_FILE = process.env.HOME + '/.bounty/event-sources.json';

async function loadConfig(): Promise<BountyIMConfig[]> {
  try {
    const { readFileSync } = await import('fs');
    const data = readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(data).sources || [];
  } catch {
    return [];
  }
}

async function saveConfig(sources: BountyIMConfig[]): Promise<void> {
  const { mkdirSync, writeFileSync } = await import('fs');
  mkdirSync(CONFIG_FILE.substring(0, CONFIG_FILE.lastIndexOf('/')), { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ version: '1.0.0', sources }, null, 2));
}

export async function esList(): Promise<void> {
  const sources = await loadConfig();
  const esSources = sources.filter(s => s.type === 'bounty-im');

  console.log(chalk.bold('\nBounty IM Event Sources:\n'));
  
  if (esSources.length === 0) {
    console.log(chalk.gray('  No bounty-im event sources configured.'));
    console.log(chalk.gray('  Use: bounty es add --address <address>\n'));
  } else {
    for (const source of esSources) {
      const status = manager.getStatus(source.id);
      const statusColor = status === 'running' ? chalk.green : 
                         status === 'error' ? chalk.red : chalk.gray;
      console.log(`  ${chalk.cyan(source.name)} [${statusColor(status)}]`);
      console.log(chalk.gray(`    ID: ${source.id}`));
      console.log(chalk.gray(`    Address: ${source.address}`));
      console.log(chalk.gray(`    URL: ${source.imServerUrl}`));
      console.log();
    }
  }
}

export async function esAdd(args: { name?: string; address: string; url?: string }): Promise<void> {
  const name = args.name || args.address.split('@')[0];
  const address = args.address;
  const url = args.url || 'ws://localhost:3001/ws';

  const config: BountyIMConfig = {
    id: generateId(),
    name,
    type: 'bounty-im',
    address,
    imServerUrl: url,
  };

  const errors = validateBountyIMConfig(config);
  if (errors.length > 0) {
    console.error(chalk.red('\n✗ Configuration errors:'));
    errors.forEach(e => console.error(chalk.yellow(`  - ${e}`)));
    process.exit(1);
  }

  try {
    manager.register(config);
    const sources = await loadConfig();
    sources.push(config);
    await saveConfig(sources);

    console.log(chalk.green('\n✓ Bounty IM event source added\n'));
    console.log(chalk.cyan('  ID:'), config.id);
    console.log(chalk.cyan('  Name:'), config.name);
    console.log(chalk.cyan('  Address:'), config.address);
    console.log(chalk.cyan('  URL:'), config.imServerUrl);
    console.log();
    console.log(chalk.gray('  Use:'));
    console.log(chalk.gray(`    bounty es start ${config.id}`));
    console.log();
  } catch (error) {
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function esStart(id: string): Promise<void> {
  try {
    const sources = await loadConfig();
    const config = sources.find(s => s.id === id || s.id.startsWith(id));

    if (!config) {
      console.error(chalk.red(`\n✗ Event source not found: ${id}`));
      console.log(chalk.gray('\nAvailable:'));
      for (const s of sources.filter(s => s.type === 'bounty-im')) {
        console.log(chalk.gray(`  - ${s.id}: ${s.name}`));
      }
      process.exit(1);
    }

    if (!manager.get(config.id)) {
      manager.register(config);
    }

    const currentStatus = manager.getStatus(config.id);
    if (currentStatus === 'running') {
      console.log(chalk.yellow(`\n⚠ Event source "${config.name}" is already running\n`));
      return;
    }

    manager.onEvent(config.id, (event: BountyIMEvent) => {
      console.log(chalk.cyan(`[消息] ${event.payload.message}`));
    });

    await manager.start(config.id);
    
    console.log(chalk.green(`\n✓ Started event source: ${config.name}`));
    console.log(chalk.gray(`  Listening for messages to: ${config.address}`));
    console.log(chalk.gray(`  Press Ctrl+C to stop\n`));

    await new Promise(() => {});

  } catch (error) {
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function esStop(id: string): Promise<void> {
  try {
    const sources = await loadConfig();
    const config = sources.find(s => s.id === id || s.id.startsWith(id));

    if (!config) {
      console.error(chalk.red(`\n✗ Event source not found: ${id}\n`));
      process.exit(1);
    }

    await manager.stop(config.id);
    console.log(chalk.green(`\n✓ Stopped event source: ${config.name}\n`));

  } catch (error) {
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

export async function esRemove(id: string): Promise<void> {
  try {
    await manager.stop(id);
    manager.unregister(id);
    const sources = await loadConfig();
    const filtered = sources.filter(s => s.id !== id && !s.id.startsWith(id));
    await saveConfig(filtered);
    console.log(chalk.green(`\n✓ Removed event source: ${id}\n`));

  } catch (error) {
    console.error(chalk.red('\n✗ Error:'), error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
