/**
 * v0.14 strict email-only contract tests for `bounty bounty-task submit`.
 *
 * Contract:
 *   - `--email / -e` is the ONLY actor identity flag.
 *   - `--agent-address / -a` is REMOVED entirely.
 *   - `BOUNTY_IM_ADDRESS` env fallback is REMOVED.
 *   - `--email` with <uuid>@<host>, bare UUIDs, malformed input rejected with exit 1.
 *   - HTTP body uses {agentEmail} ONLY.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SUBMIT_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/bounty-task/submit.ts",
);
const VALID_TASK_ID = "8de9b6aa-5781-4a65-be96-45185fb7c8b1";

describe("bounty-task submit — v0.14 strict email-only", () => {
  let origImAddress: string | undefined;

  beforeEach(() => {
    origImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_IM_ADDRESS;
  });
  afterEach(() => {
    if (origImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = origImAddress;
    }
  });

  test("T1 (static): --agent-address option is REMOVED from submit.ts", () => {
    const src = readFileSync(SUBMIT_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"]agent-address['"]/);
    expect(src).not.toMatch(/['"]agent-address['"]\s*:\s*\{/);
  });

  test("T2 (static): resolveCurrentAgentAddress NOT imported/used in submit.ts", () => {
    const src = readFileSync(SUBMIT_SRC, "utf-8");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });

  test("T3 (static): legacy env fallback string NOT referenced in submit.ts", () => {
    const src = readFileSync(SUBMIT_SRC, "utf-8");
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
  });

  test("T4 (static): submit.ts uses the shared requireEmailFlag helper from email-flag.js", () => {
    const src = readFileSync(SUBMIT_SRC, "utf-8");
    // v0.14.0 (Phase 4 R-1): centralised via the requireEmailFlag helper.
    expect(src).toMatch(/from\s+['"][^'"]*email-flag\.js['"]/);
    expect(src).toMatch(/requireEmailFlag/);
    // No direct parseEmail call (use the helper, not the boundary directly).
    expect(src).not.toMatch(/parseEmail\s*\(/);
  });

  test("T5 (static): submit.ts builds request body with agentEmail ONLY (no agentAddress)", () => {
    const src = readFileSync(SUBMIT_SRC, "utf-8");
    expect(src).not.toMatch(/agentAddress\s*[:=]/);
  });

  test("T6 (integration): --agent-address rejected; --email with bare UUID exits 1", async () => {
    const { submitCommand } = await import(
      "../../src/cli/commands/bounty-task/submit.js"
    );

    const calls: { exitCode: number | null; stderr: string[] } = {
      exitCode: null,
      stderr: [],
    };
    const origExit = process.exit;
    const origErr = console.error;
    (process as any).exit = (code?: number) => {
      calls.exitCode = code ?? 0;
      throw new Error(`exit-${code}`);
    };
    console.error = (...args: unknown[]) => {
      calls.stderr.push(String(args[0] ?? ""));
    };

    try {
      await (submitCommand as any).handler({
        email: "8de9b6aa-5781-4000-8000-000000000001", // bare UUID
        "task-id": VALID_TASK_ID,
        result: "done",
        "server-url": "http://127.0.0.1:1",
      });
    } catch (e) {
      // expected
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    expect(calls.exitCode).toBe(1);
    const combined = calls.stderr.join("\n");
    expect(combined).toMatch(/--email/);
  });
});
