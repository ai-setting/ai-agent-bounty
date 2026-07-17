#!/usr/bin/env bun

import { readFileSync } from "node:fs";

export const CATEGORY_KEYS = [
  "test",
  "lint",
  "typecheck",
  "build",
  "cli-smoke",
] as const;

export type Category = (typeof CATEGORY_KEYS)[number];
export type CategoryMap<T> = Record<Category, T>;

export interface BaselineCaptured {
  schema: "roy-rd-pipeline-baseline/v1";
  stage: string;
  task_id: number;
  captured_at: string;
  invocation_hash: string;
  worktree_path: string;
  command_lines: string[];
  failures: CategoryMap<string[]>;
  pass_counts: CategoryMap<number>;
  exit_codes: CategoryMap<number>;
  log_tail: CategoryMap<string[]>;
}

export interface DiffResult {
  new_regressions: CategoryMap<string[]>;
  fixed_pre_existing: CategoryMap<string[]>;
  unchanged: CategoryMap<string[]>;
  pass: boolean;
  reasons_for_fail: string[];
}

export interface DiffOptions {
  strictSubset?: boolean;
  commandAllowList?: string[];
}

const emptyCategoryMap = <T>(factory: () => T): CategoryMap<T> =>
  Object.fromEntries(CATEGORY_KEYS.map((category) => [category, factory()])) as CategoryMap<T>;

const sortedUnique = (values: string[]): string[] =>
  [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();

const hasStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const addReason = (reasons: string[], reason: string): void => {
  if (!reasons.includes(reason)) reasons.push(reason);
};

const validateCaptureHeader = (
  capture: BaselineCaptured,
  label: "baseline" | "modified",
  reasons: string[],
): void => {
  if (!capture || typeof capture !== "object") {
    addReason(reasons, `invalid_capture:${label}`);
    return;
  }
  if (capture.schema !== "roy-rd-pipeline-baseline/v1") {
    addReason(reasons, `schema_mismatch:${label}`);
  }
  if (!Array.isArray(capture.command_lines) || !capture.command_lines.every((line) => typeof line === "string")) {
    addReason(reasons, `invalid_command_lines:${label}`);
  }
};

export function diffBaselineVsModified(
  baseline: BaselineCaptured,
  modified: BaselineCaptured,
  options: DiffOptions = {},
): DiffResult {
  const reasons: string[] = [];
  const newRegressions = emptyCategoryMap<string[]>(() => []);
  const fixedPreExisting = emptyCategoryMap<string[]>(() => []);
  const unchanged = emptyCategoryMap<string[]>(() => []);

  validateCaptureHeader(baseline, "baseline", reasons);
  validateCaptureHeader(modified, "modified", reasons);

  if (baseline.invocation_hash !== modified.invocation_hash) {
    addReason(reasons, "command_set_drift");
  }
  if (baseline.worktree_path !== modified.worktree_path) {
    addReason(reasons, "worktree_drift");
  }
  if (baseline.task_id !== modified.task_id) {
    addReason(reasons, "task_id_drift");
  }
  if (baseline.stage !== modified.stage) {
    addReason(reasons, "stage_drift");
  }

  if (options.commandAllowList) {
    const allowList = new Set(options.commandAllowList);
    for (const command of [...(baseline.command_lines ?? []), ...(modified.command_lines ?? [])]) {
      if (!allowList.has(command)) addReason(reasons, `command_not_allowed:${command}`);
    }
  }

  for (const category of CATEGORY_KEYS) {
    const baselineValues = baseline.failures?.[category];
    const modifiedValues = modified.failures?.[category];

    if (!hasStringArray(baselineValues) || !hasStringArray(modifiedValues)) {
      addReason(reasons, `missing_category:${category}`);
      continue;
    }

    const baselineSorted = sortedUnique(baselineValues);
    const modifiedSorted = sortedUnique(modifiedValues);
    const baselineSet = new Set(baselineSorted);
    const modifiedSet = new Set(modifiedSorted);

    newRegressions[category] = modifiedSorted.filter((id) => !baselineSet.has(id));
    fixedPreExisting[category] = baselineSorted.filter((id) => !modifiedSet.has(id));
    unchanged[category] = modifiedSorted.filter((id) => baselineSet.has(id));

    const baselineExit = baseline.exit_codes?.[category];
    const modifiedExit = modified.exit_codes?.[category];
    if (typeof baselineExit !== "number" || typeof modifiedExit !== "number") {
      addReason(reasons, `missing_exit_code:${category}`);
      continue;
    }

    if ((baselineExit !== 0 && baselineSorted.length === 0) ||
        (modifiedExit !== 0 && modifiedSorted.length === 0)) {
      addReason(reasons, `capture_status_invalid:${category}`);
    }
  }

  if (options.strictSubset) {
    for (const category of CATEGORY_KEYS) {
      if (newRegressions[category].length > 0) {
        addReason(reasons, `not_subset:${category}`);
      }
    }
  }

  reasons.sort();
  const hasRegressions = CATEGORY_KEYS.some((category) => newRegressions[category].length > 0);

  return {
    new_regressions: newRegressions,
    fixed_pre_existing: fixedPreExisting,
    unchanged,
    pass: reasons.length === 0 && !hasRegressions,
    reasons_for_fail: reasons,
  };
}

const getArg = (name: string): string | undefined => {
  const index = Bun.argv.indexOf(name);
  return index >= 0 ? Bun.argv[index + 1] : undefined;
};

const runCli = (): void => {
  const baselinePath = getArg("--baseline");
  const modifiedPath = getArg("--modified");
  const allowList = (getArg("--command-allow-list") ?? "")
    .split(/[,|\s]+/)
    .filter(Boolean);
  if (!baselinePath || !modifiedPath) {
    console.error(
      "Usage: bun scripts/verify-rd-pipeline-baseline.ts --baseline <path> --modified <path> [--command-allow-list <cmd1,cmd2>]",
    );
    process.exitCode = 2;
    return;
  }

  let baseline: BaselineCaptured;
  let modified: BaselineCaptured;
  try {
    baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as BaselineCaptured;
    modified = JSON.parse(readFileSync(modifiedPath, "utf8")) as BaselineCaptured;
  } catch (error) {
    console.error(
      JSON.stringify({
        pass: false,
        reasons_for_fail: ["capture_parse_failed"],
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    process.exitCode = 2;
    return;
  }

  const options: DiffOptions = allowList.length > 0 ? { commandAllowList: allowList } : {};
  const result = diffBaselineVsModified(baseline, modified, options);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.pass ? 0 : 1;
};

if (import.meta.main) runCli();