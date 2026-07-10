/**
 * Shared helpers for `--json` and `--quiet` flags on bounty-task CLI commands.
 *
 * Phase: feat/bounty-task-optimize (Tier B)
 *
 * 设计动机：
 * - `--json` 让 agent 程序化解析结果（不需要 grep 装饰文字）
 * - `--quiet` 抑制装饰性输出（"✓ Task published" 等 box），保留 stderr 错误
 *   但通常仍打印 task id 等关键信息，便于脚本下一步处理
 *
 * 用法：
 *   import { shouldJson, jsonOutput, quietIdOutput } from '../lib/json-output.js';
 *
 *   if (shouldJson(argv)) {
 *     jsonOutput(task);
 *   } else if (isQuiet(argv)) {
 *     quietIdOutput(task);
 *   } else {
 *     console.log('✓ Task published');
 *     console.log('  ID:', task.id);
 *     // ...
 *   }
 */

/** True when the user passed --json (or BOUNTY_JSON env) */
export function shouldJson(argv: any): boolean {
  if (argv?.json === true) return true;
  if (process.env.BOUNTY_JSON === '1' || process.env.BOUNTY_JSON === 'true') return true;
  return false;
}

/** True when the user passed --quiet (or BOUNTY_QUIET env). */
export function isQuiet(argv: any): boolean {
  if (argv?.quiet === true) return true;
  if (process.env.BOUNTY_QUIET === '1' || process.env.BOUNTY_QUIET === 'true') return true;
  return false;
}

/**
 * Print `value` as a single line of JSON to stdout.
 * Used in --json mode (or json+quiet mode).
 */
export function jsonOutput(value: unknown): void {
  console.log(JSON.stringify(value));
}

/**
 * Print a single-line summary (typically just the id) suitable for
 * `bounty bounty-task publish --quiet` — agent can pipe into next step.
 *
 * Format: `id: <id>` (single space, single line) so scripts can grep.
 */
export function quietIdOutput(task: { id: string }): void {
  console.log(`id: ${task.id}`);
}