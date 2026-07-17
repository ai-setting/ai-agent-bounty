/**
 * v0.14 strict email-only contract tests for `bounty bounty-task cancel`.
 *
 * Contract: --publisher-email / -e is the ONLY publisher identity flag.
 * --publisher-address / -p REMOVED. BOUNTY_IM_ADDRESS REMOVED.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const CANCEL_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/bounty-task/cancel.ts",
);
const VALID_TASK_ID = "8de9b6aa-5781-4a65-be96-45185fb7c8b1";

describe("bounty-task cancel — v0.14 strict email-only", () => {
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

  test("T1: --publisher-address option REMOVED from cancel.ts", () => {
    const src = readFileSync(CANCEL_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"]publisher-address['"]/);
    expect(src).not.toMatch(/['"]publisher-address['"]\s*:\s*\{/);
  });

  test("T2: --publisher-email / -e option PRESENT", () => {
    const src = readFileSync(CANCEL_SRC, "utf-8");
    expect(src).toMatch(/\.option\(\s*['"]publisher-email['"]/);
    expect(src).toMatch(/['"]publisher-email['"][\s\S]{0,200}alias:\s*['"]e['"]/);
  });

  test("T3: legacy parser / env fallback REMOVED", () => {
    const src = readFileSync(CANCEL_SRC, "utf-8");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
    expect(src).not.toMatch(/resolveAddressOption/);
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
  });

  test("T4: requireEmailFlag helper from email-flag.js + body uses publisherEmail ONLY", () => {
    const src = readFileSync(CANCEL_SRC, "utf-8");
    // v0.14.0 (Phase 4 R-1): centralised via the requireEmailFlag helper.
    expect(src).toMatch(/from\s+['"][^'"]*email-flag\.js['"]/);
    expect(src).toMatch(/requireEmailFlag/);
    expect(src).not.toMatch(/parseEmail\s*\(/);
    expect(src).not.toMatch(/publisherAddress\s*[:=]/);
  });

  test("T5: --publisher-email with bare UUID exits 1 + --publisher-email hint", async () => {
    const { cancelCommand } = await import(
      "../../src/cli/commands/bounty-task/cancel.js"
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
      await (cancelCommand as any).handler({
        "task-id": VALID_TASK_ID,
        "publisher-email": "8de9b6aa-5781-4000-8000-000000000001",
        "server-url": "http://127.0.0.1:1",
      });
    } catch (e) {
      // expected
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    expect(calls.exitCode).toBe(1);
    expect(calls.stderr.join("\n")).toMatch(/--publisher-email/);
  });
});
