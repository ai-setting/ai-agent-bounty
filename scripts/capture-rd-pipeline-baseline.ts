#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  CATEGORY_KEYS,
  type BaselineCaptured,
  type Category,
  type CategoryMap,
} from "./verify-rd-pipeline-baseline";

export { CATEGORY_KEYS };
export type { Category };

/**
 * ai-agent-bounty project: CLI E2E commands (Phase 6).
 *
 * - build: typecheck + build:cli (combined — single command line, but two-step run)
 * - test: full bun test --parallel 4 with BOUNTY_MAIL_DRY_RUN=1
 * - cli-smoke: bounty CLI help (dist/cli.js)
 */
export const COMMANDS: Record<Category, string> = {
  // NOTE: --parallel=4 (with `=`) not `--parallel 4` — the latter is parsed as
  // `--parallel` (parallel mode) + positional arg `4` (file-name filter), which
  // matches zero files and produces a misleading "no tests found" exit 1.
  test: "BOUNTY_MAIL_DRY_RUN=1 bun test --parallel=4",
  lint: "echo no-lint-skip",
  typecheck: "bun run typecheck",
  build: "bun run typecheck && bun run build:cli",
  // ai-agent-bounty binary entry is dist/bin/bounty.js (built from src/bin/bounty.ts
  // which calls runBountyCli()). dist/cli.js is the library form and does NOT auto-invoke
  // the parser, so `bun dist/cli.js --help` exits 0 silently.
  "cli-smoke": "bun dist/bin/bounty.js --help",
};

export const commandForStage = (_stage: string, category: Category): string =>
  COMMANDS[category];

const STAGE_CATEGORIES: Record<string, Category[]> = {
  tdd: ["test", "lint", "typecheck"],
  review: ["test", "lint", "typecheck"],
  e2e: ["build", "test", "cli-smoke"],
  verify: ["test", "lint", "typecheck", "build", "cli-smoke"],
  core: ["test", "typecheck"],
  cli: ["test", "lint", "build", "cli-smoke"],
  all: [...CATEGORY_KEYS],
};

const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, " ");

const stableToken = (value: string): string =>
  normalizeWhitespace(value)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/[^a-zA-Z0-9_./@-]+/g, "_")
    .replace(/^_+|_+$/g, "");

export const normalizeCommandLines = (commandLines: string[]): string[] =>
  commandLines.map(normalizeWhitespace);

export const computeInvocationHash = (commandLines: string[]): string =>
  createHash("sha256")
    .update(normalizeCommandLines(commandLines).join("\n"))
    .digest("hex");

const currentFileFromLine = (line: string): string | undefined => {
  const match = line.match(/^(.+\.(?:[cm]?[jt]sx?|vue|svelte)):\s*$/);
  return match?.[1];
};

/**
 * Parse bun test "fail" markers from output.
 * Example: "(fail) bounty bounty-task grab > should resolve agent by email"
 */
const parseTestFailure = (line: string, currentFile: string | undefined): string | undefined => {
  const match = line.match(/\(fail\)\s+(.+?)(?:\s+\[[^\]]+\])?\s*$/);
  if (!match) return undefined;
  const file = currentFile ?? "command";
  const symbol = stableToken(match[1]);
  return `test:${file}:${symbol || "unknown"}:E_TEST_FAILURE`;
};

const parseLintFailure = (line: string): string | undefined => {
  const match = line.match(/^(.+?):(\d+):\d+\s+(?:warning|error)\s+.*?\s+([@a-zA-Z0-9/_-]+)\s*$/i);
  if (!match) return undefined;
  return `lint:${match[1]}:${match[3]}:${match[2]}`;
};

const parseTypecheckFailure = (line: string): string | undefined => {
  const paren = line.match(/^(.+?)\((\d+),\d+\):\s*(?:error|warning)\s+(TS\d+)/i);
  if (paren) return `typecheck:${paren[1]}:${paren[3].toUpperCase()}:${paren[2]}`;
  const colon = line.match(/^(.+?):(\d+)(?::\d+)?\s+-?\s*(?:error|warning)\s+(TS\d+)/i);
  if (colon) return `typecheck:${colon[1]}:${colon[3].toUpperCase()}:${colon[2]}`;
  return undefined;
};

const parseBuildFailure = (line: string): string | undefined => {
  const diagnostic = line.match(/^(.+?):(\d+)(?::\d+)?\s*(?:error|ERROR)\s+(TS\d+|[A-Z][A-Z0-9_-]*)/);
  if (diagnostic) return `build:${diagnostic[1]}:${diagnostic[3]}:${diagnostic[2]}`;
  if (/\b(?:error|failed|failure)\b/i.test(line)) {
    return "build:command:build:E_BUILD_FAILURE";
  }
  return undefined;
};

const parseCliSmokeFailure = (line: string): string | undefined => {
  // CLI smoke: match only STRONG failure indicators, not arbitrary mentions of
  // "error"/"failed" in yargs help text or plugin banner output.
  // Strong signals:
  //   - "Error: <message>" (yargs throws)
  //   - "Unknown argument/command: <x>"
  //   - "command not found" (lowercase, prefix-style)
  //   - "throw" / "TypeError" / "SyntaxError" / stack-trace lines starting with "at "
  if (/^(?:Error|TypeError|SyntaxError|ReferenceError):\s/i.test(line.trim())) {
    return "cli-smoke:bounty:help:E_CLI_SMOKE";
  }
  if (/^\s*at\s+.*\(.+:\d+:\d+\)\s*$/i.test(line)) {
    return "cli-smoke:bounty:help:E_CLI_SMOKE_STACK";
  }
  if (/^Unknown (?:argument|command)s?:/i.test(line.trim())) {
    return "cli-smoke:bounty:help:E_UNKNOWN_COMMAND";
  }
  if (/^command not found[:\s]/i.test(line.trim())) {
    return "cli-smoke:bounty:help:E_COMMAND_NOT_FOUND";
  }
  return undefined;
};

const fallbackFailureId = (category: Category, exitCode: number): string | undefined => {
  if (exitCode === 0) return undefined;
  switch (category) {
    case "test":
      return `test:command:all:E_TEST_EXIT_${exitCode}`;
    case "lint":
      return `lint:command:all:E_LINT_EXIT_${exitCode}`;
    case "typecheck":
      return `typecheck:command:all:E_TYPECHECK_EXIT_${exitCode}`;
    case "build":
      return `build:command:build:E_BUILD_EXIT_${exitCode}`;
    case "cli-smoke":
      return `cli-smoke:bounty:help:E_EXIT_${exitCode}`;
  }
};

export const parseFailureIds = (category: Category, output: string, exitCode: number): string[] => {
  const ids: string[] = [];
  let currentFile: string | undefined;
  for (const line of output.split(/\r?\n/)) {
    currentFile = currentFileFromLine(line) ?? currentFile;
    const id =
      category === "test"
        ? parseTestFailure(line, currentFile)
        : category === "lint"
          ? parseLintFailure(line)
          : category === "typecheck"
            ? parseTypecheckFailure(line)
            : category === "build"
              ? parseBuildFailure(line)
              : parseCliSmokeFailure(line);
    if (id) ids.push(id);
  }

  const unique = [...new Set(ids)].sort();
  if (unique.length > 0 || exitCode === 0 || output.trim().length === 0) return unique;
  const fallback = fallbackFailureId(category, exitCode);
  return fallback ? [fallback] : unique;
};

const tailLines = (output: string, limit = 20): string[] =>
  output.split(/\r?\n/).filter(Boolean).slice(-limit);

const emptyCategoryMap = <T>(factory: () => T): CategoryMap<T> =>
  Object.fromEntries(CATEGORY_KEYS.map((category) => [category, factory()])) as CategoryMap<T>;

interface CommandResult {
  output: string;
  exitCode: number;
  timedOut: boolean;
}

const runCommand = (command: string, timeoutMs: number): CommandResult => {
  const result = spawnSync(command, {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 16 * 1024 * 1024,
    env: {
      ...process.env,
      CI: "0",
      BUN_PARALLEL: "4",
      BOUNTY_MAIL_DRY_RUN: "1",
    },
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  const exitCode = typeof result.status === "number" ? result.status : timedOut ? 124 : 1;
  return { output, exitCode, timedOut };
};

const atomicWriteJson = (path: string, value: unknown): void => {
  const absolutePath = resolve(path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  const tempPath = `${absolutePath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, absolutePath);
};

const valuesFromArg = (name: string): string[] => {
  const argv = process.argv;
  const values: string[] = [];
  argv.forEach((value, index) => {
    if (value === name && argv[index + 1]) values.push(argv[index + 1]);
  });
  return values;
};

const firstArg = (name: string): string | undefined => valuesFromArg(name)[0];

export const categoriesForStage = (stage: string, categoryArg?: string): Category[] => {
  const normalizedStage = stage === "tdd-implement" ? "tdd" : stage === "code-review" ? "review" : stage === "cli-e2e-test" ? "e2e" : stage === "final-verify" ? "verify" : stage;
  if (!categoryArg || categoryArg === "all") return [...(STAGE_CATEGORIES[normalizedStage] ?? STAGE_CATEGORIES.all)];
  const requested = categoryArg.split(/[,|\s]+/).filter(Boolean) as Category[];
  return [...new Set(requested.filter((category) => CATEGORY_KEYS.includes(category)))];
};

export const capture = (options: {
  stage: string;
  categories: Category[];
  taskId: number;
  outPath: string;
  timeoutMs: number;
}): BaselineCaptured => {
  const failures = emptyCategoryMap<string[]>(() => []);
  const passCounts = emptyCategoryMap<number>(() => 0);
  const exitCodes = emptyCategoryMap<number>(() => 0);
  const logTail = emptyCategoryMap<string[]>(() => []);
  const commandLines = options.categories.map((category) => `${category}=${commandForStage(options.stage, category)}`);
  const captureErrors: string[] = [];

  for (const category of options.categories) {
    const command = commandForStage(options.stage, category);
    const result = runCommand(command, options.timeoutMs);
    failures[category] = parseFailureIds(category, result.output, result.exitCode);
    exitCodes[category] = result.exitCode;
    logTail[category] = tailLines(result.output);
    passCounts[category] = (result.output.match(/\(pass\)|\bpassed\b|\bwarning\b/gi) ?? []).length;
    if (result.timedOut) captureErrors.push(`timeout:${category}`);
  }

  const captureOutput: BaselineCaptured & { capture_errors?: string[] } = {
    schema: "roy-rd-pipeline-baseline/v1",
    stage: options.stage,
    task_id: options.taskId,
    captured_at: new Date().toISOString(),
    invocation_hash: computeInvocationHash(commandLines),
    worktree_path: process.cwd(),
    command_lines: commandLines,
    failures,
    pass_counts: passCounts,
    exit_codes: exitCodes,
    log_tail: logTail,
    ...(captureErrors.length > 0 ? { capture_errors: captureErrors } : {}),
  };
  atomicWriteJson(options.outPath, captureOutput);
  return captureOutput;
};

const runCli = (): void => {
  const stage = firstArg("--stage") ?? "all";
  const categoryArg = firstArg("--category");
  const outPath = firstArg("--out");
  const timeoutMs = Number(firstArg("--timeout-ms") ?? 600_000); // 10 min default for full test suite
  if (!outPath || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    console.error(
      "Usage: bun scripts/capture-rd-pipeline-baseline.ts --stage <stage> --category <category[,category]> --out <path> [--task-id <id>] [--timeout-ms <ms>]",
    );
    process.exitCode = 2;
    return;
  }

  const taskId = Number(firstArg("--task-id") ?? process.env.ROY_TASK_ID ?? 0);
  const categories = categoriesForStage(stage, categoryArg);
  if (!Number.isInteger(taskId) || taskId < 0 || categories.length === 0) {
    console.error(JSON.stringify({ pass: false, reasons_for_fail: ["invalid_capture_arguments"] }));
    process.exitCode = 2;
    return;
  }

  try {
    const output = capture({ stage, categories, taskId, outPath, timeoutMs });
    console.log(
      JSON.stringify({
        schema: output.schema,
        stage: output.stage,
        task_id: output.task_id,
        out: resolve(outPath),
        categories,
        exit_codes: output.exit_codes,
        failure_counts: Object.fromEntries(
          CATEGORY_KEYS.map((category) => [category, output.failures[category].length]),
        ),
      }),
    );
    // Non-zero command exits are data in a baseline capture, not a capture-process error.
    process.exitCode = 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        pass: false,
        reasons_for_fail: ["capture_write_failed"],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 2;
  }
};

if (import.meta.main) runCli();