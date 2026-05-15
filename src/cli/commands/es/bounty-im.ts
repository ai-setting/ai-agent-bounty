/**
 * Bounty IM EventSource Commands
 * 
 * 扩展 roy-agent EventSource 命令，添加 bounty-im 类型支持
 */

import chalk from 'chalk';
import type { CommandModule } from 'yargs';
import { bountyIMEventSourceComponent, createBountyIMConfig } from '../../../im/eventsource/index.js';

/**
 * Bounty IM EventSource Add Command
 * 
 * 添加 bounty-im 事件源
 */
export const BountyIMAddCommand: CommandModule = {
  command: 'add <name> bounty-im',
  describe: '添加 Bounty IM 事件源',

  builder: (yargs) =>
    yargs
      .positional('name', {
        describe: '事件源名称',
        type: 'string',
        demandOption: true,
      })
      .positional('type', {
        describe: '事件源类型',
        type: 'string',
        default: 'bounty-im',
      })
      .option('address', {
        alias: 'a',
        describe: 'Bounty IM 地址 (格式: agent-id@host)',
        type: 'string',
        demandOption: true,
      })
      .option('url', {
        alias: 'u',
        describe: 'IM 服务器 WebSocket URL',
        type: 'string',
        default: 'ws://localhost:3001/ws',
      })
      .option('event-types', {
        alias: 'e',
        describe: '事件类型过滤（逗号分隔）',
        type: 'string',
      }),

  handler: async (args) => {
    const name = args.name as string;
    const address = args.address as string;
    const url = args.url as string;
    const eventTypes = args['event-types'] as string | undefined;

    try {
      // 创建配置
      const config = createBountyIMConfig({
        name,
        address,
        imServerUrl: url,
        eventTypes: eventTypes?.split(',').map(s => s.trim()),
      });

      // 注册到组件
      bountyIMEventSourceComponent.register(config);

      console.log(chalk.green('\n✓ Bounty IM 事件源添加成功！\n'));
      console.log(`  ${chalk.cyan('名称:')} ${config.name}`);
      console.log(`  ${chalk.cyan('ID:')} ${config.id}`);
      console.log(`  ${chalk.cyan('地址:')} ${config.address}`);
      console.log(`  ${chalk.cyan('URL:')} ${config.imServerUrl}`);
      console.log();
      console.log(chalk.gray(`使用 'bounty es start ${config.id.substring(0, 8)}' 启动它。`));
      console.log();
    } catch (error) {
      console.error(chalk.red('\n✗ 添加失败:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  },
};

/**
 * Bounty IM EventSource List Command
 */
export const BountyIMListCommand: CommandModule = {
  command: 'list',
  describe: '列出 Bounty IM 事件源',

  builder: (yargs) =>
    yargs.command({
      command: 'bounty-im',
      describe: '仅列出 bounty-im 类型',
      handler: async () => {
        const sources = bountyIMEventSourceComponent.list().filter(s => s.type === 'bounty-im');

        console.log(chalk.bold('\nBounty IM 事件源:\n'));

        if (sources.length === 0) {
          console.log(chalk.gray('  暂无 bounty-im 事件源'));
          console.log(chalk.gray('  使用 bounty es add <name> bounty-im --address xxx 添中\n'));
        } else {
          for (const source of sources) {
            const status = bountyIMEventSourceComponent.getStatus(source.id);
            const statusColor = status === 'running' ? chalk.green :
                              status === 'error' ? chalk.red : chalk.gray;
            console.log(`  ${chalk.cyan(source.name)} [${statusColor(status || 'created')}]`);
            console.log(chalk.gray(`    ID: ${source.id}`));
            console.log(chalk.gray(`    地址: ${source.address}`));
            console.log(chalk.gray(`    URL: ${source.imServerUrl}`));
            console.log();
          }
        }
      },
    }),

  handler: () => {},
};
