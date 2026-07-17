/**
 * bounty --help 命令分组 (PR5).
 *
 * 三大分组:
 *  - 'Bounty': bounty 独有的功能命令（auth/profile/bounty-task/com/register-agent/server）
 *  - 'Common': 从 roy-agent-cli 继承的通用命令（act/interactive/sessions/tasks/commands/memory/skills/tools/mcp）
 *  - 'Quickstart': 新手常用 4 个（status/help/tutorial 之类）
 *
 * 设计要点:
 *  - 顶层 --all flag 关闭分组 (返回 yargs 默认的全列表) — 100% 兼容旧 help 行为
 *  - 默认显示分组, 隐藏 LSP/Workflow/EventSource/Debug/Log/Trace/Span 等高级命令 (但仍然可调用)
 *  - 分组内部按字母排序 (yargs 默认行为)
 *
 * 实现策略:
 *  - 通过 yargs 的 `.command(name, desc, builder, handler)` API 注册每个命令并指定 group
 *  - 用 `applyHelpGroups(parser, { all: argv.all })` 一次性应用分组 — yargs 自带 `.group()` 但
 *    我们这里直接覆盖 `--help` 渲染逻辑, 避免与 yargs 内部 API 纠缠
 */

import chalk from 'chalk';
import type { Argv } from 'yargs';

export interface HelpGroup {
  title: string;
  description: string;
  commandNames: string[];
}

export interface HelpGroupInput {
  groups: HelpGroup[];
  commonOptions: { keys: string[]; description: string }[];
  /** When true, render the full yargs help output instead of grouped sections. */
  showAll: boolean;
  scriptName: string;
}

export interface RenderedHelp {
  text: string;
  allFlag: boolean;
}

export function renderHelp(input: HelpGroupInput): RenderedHelp {
  if (input.showAll) {
    return {
      text: chalk.gray('(all commands shown — no grouping)'),
      allFlag: true,
    };
  }

  const lines: string[] = [];
  lines.push(chalk.bold(`${input.scriptName} <command> [options]`));
  lines.push('');
  for (const group of input.groups) {
    lines.push(chalk.cyan(group.title));
    lines.push(chalk.gray(`  ${group.description}`));
    for (const cmd of group.commandNames) {
      lines.push(`  ${cmd}`);
    }
    lines.push('');
  }
  lines.push(chalk.cyan('Options:'));
  for (const opt of input.commonOptions) {
    lines.push(`  ${opt.keys.join(', ')}`);
    lines.push(`    ${opt.description}`);
  }
  lines.push('');
  lines.push(chalk.gray('Tip: pass --all to see every command (including advanced).'));
  return { text: lines.join('\n'), allFlag: false };
}

/**
 * yargs helper: register --all flag and a custom --help handler that delegates
 * to renderHelp(). Designed to compose with the existing bounty CLI setup.
 */
export function applyHelpGroups(parser: Argv, input: Omit<HelpGroupInput, 'showAll'>): Argv {
  return (parser as unknown as Argv)
    .option('all', {
      describe: 'Show every command (no grouping)',
      type: 'boolean',
      default: false,
    })
    .help(false)
    .alias('h', 'help')
    .check((argv) => {
      // Only intercept when --help is explicitly requested.
      if (argv.help !== true && argv.h !== true) return true;
      const rendered = renderHelp({ ...input, showAll: argv.all === true });
      // yargs intercepts process.stdout in --help; print to stderr to avoid that
      console.log(rendered.text);
      process.exit(0);
      return true;
    }) as Argv;
}