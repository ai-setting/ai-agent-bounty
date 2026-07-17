/**
 * v0.14 strict email-only contract tests for `bounty bounty-task grab`.
 *
 * Contract:
 *   - `--email / -e` is the ONLY actor identity flag.
 *   - `--agent-address / -a` is REMOVED entirely from the option surface.
 *   - `BOUNTY_IM_ADDRESS` env fallback is REMOVED.
 *   - `<uuid>@<host>` and bare UUIDs in --email are rejected with exit 1.
 *   - HTTP request body uses `{agentEmail}` ONLY (no `agentAddress`).
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const GRAB_SRC = resolve(
  import.meta.dir,
  '../../src/cli/commands/bounty-task/grab.ts',
);
const VALID_TASK_ID = '8de9b6aa-5781-4a65-be96-45185fb7c8b1';

describe("bounty-task grab — v0.14 strict email-only", () => {
  let origFetch: typeof fetch;
  let origImAddress: string | undefined;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    origImAddress = process.env.BOUNTY_IM_ADDRESS;
    delete process.env.BOUNTY_IM_ADDRESS;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
    if (origImAddress === undefined) {
      delete process.env.BOUNTY_IM_ADDRESS;
    } else {
      process.env.BOUNTY_IM_ADDRESS = origImAddress;
    }
  });

  test("T1 (static): --agent-address option is REMOVED from grab.ts", () => {
    const src = readFileSync(GRAB_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"]agent-address['"]/);
    expect(src).not.toMatch(/['"]agent-address['"]\s*:\s*\{/);
  });

  test("T2 (static): resolveCurrentAgentAddress is NOT imported/used in grab.ts", () => {
    const src = readFileSync(GRAB_SRC, "utf-8");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });

  test("T3 (static): BOUNTY_IM_ADDRESS env is NOT referenced in grab.ts", () => {
    const src = readFileSync(GRAB_SRC, "utf-8");
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
  });

  test("T4 (static): grab.ts imports parseEmail from email-resolver", () => {
    const src = readFileSync(GRAB_SRC, "utf-8");
    expect(src).toMatch(/from\s+['"][^'"]*email-resolver\.js['"]/);
    expect(src).toMatch(/parseEmail/);
  });

  test("T5 (static): grab.ts builds request body with agentEmail ONLY (no agentAddress)", () => {
    const src = readFileSync(GRAB_SRC, "utf-8");
    // v0.14 strictly forbids building agentAddress in the body.
    expect(src).not.toMatch(/agentAddress\s*[:=]/);
  });

  test("T6 (integration): --email is required, --agent-address is unknown option", async () => {
    const { grabCommand } = await import(
      "../../src/cli/commands/bounty-task/grab.js"
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
      await (grabCommand as any).handler({
        "agent-address":
          "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
        "task-id": VALID_TASK_ID,
        "server-url": "http://127.0.0.1:1",
      });
    } catch (e) {
      // expected — process.exit throws
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    // Either yargs rejects the unknown option, or our handler exits non-zero.
    const combined = calls.stderr.join("\n");
    expect(
      calls.exitCode === 1 ||
        calls.exitCode === 2 ||
        /unknown argument/i.test(combined) ||
        /use --email/.test(combined),
    ).toBe(true);
  });

  test("T7 (integration): --email with bare UUID is rejected with --email hint", async () => {
    const { grabCommand } = await import(
      "../../src/cli/commands/bounty-task/grab.js"
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
      await (grabCommand as any).handler({
        email: "8de9b6aa-5781-4000-8000-000000000001", // bare UUID
        "task-id": VALID_TASK_ID,
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
