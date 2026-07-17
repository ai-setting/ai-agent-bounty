/**
 * v0.14 strict email-only contract tests for `bounty com send`.
 *
 * Contract:
 *   - --from-email / -F is the ONLY sender flag.
 *   - --to-email / -T is the ONLY recipient flag.
 *   - --from / -f and --to / -t (legacy address flags) REMOVED.
 *   - HTTP body uses {from_email, to_email} ONLY (no `from` / `to` keys).
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const SEND_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/com/send.ts",
);

describe("com send — v0.14 strict email-only", () => {
  test("T1: --from and --to legacy address flags REMOVED from send.ts", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    // --from / -f as legacy address option (NOT --from-email)
    expect(src).not.toMatch(/\.option\(\s*['"]from['"][^)]*LEGACY/);
    expect(src).not.toMatch(/\.option\(\s*['"]to['"][^)]*LEGACY/);
  });

  test("T2: --from-email / -F and --to-email / -T flags PRESENT", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    expect(src).toMatch(/\.option\(\s*['"]from-email['"]/);
    expect(src).toMatch(/\.option\(\s*['"]to-email['"]/);
  });

  test("T3: requireEmailFlag helper from email-flag.js + body uses from_email/to_email ONLY", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    // v0.14.0 (Phase 4 R-1+R-6): centralised via the requireEmailFlag helper.
    expect(src).toMatch(/from\s+['"][^'"]*email-flag\.js['"]/);
    expect(src).toMatch(/requireEmailFlag/);
    // No direct parseEmail call (use the helper, not the boundary directly).
    expect(src).not.toMatch(/parseEmail\s*\(/);
    // Body must use from_email + to_email, not legacy `from` / `to` keys.
    expect(src).toMatch(/from_email:/);
    expect(src).toMatch(/to_email:/);
    // Check that the requestBody object literal doesn't have `from:` / `to:`
    // as separate keys (excluding the requestBody content object).
    expect(src).not.toMatch(/requestBody\.from\b/);
    expect(src).not.toMatch(/requestBody\.to\b/);
  });

  test("T4: legacy 'from' / 'to' body keys NOT built", () => {
    const src = readFileSync(SEND_SRC, "utf-8");
    // The line `requestBody.from = resolvedFrom` or `body.from = ...` must be gone.
    expect(src).not.toMatch(/body\.from\s*=/);
    expect(src).not.toMatch(/body\.to\s*=/);
  });

  test("T5: integration — --from-email with bare UUID exits 1 + hint", async () => {
    const { sendCommand } = await import("../../src/cli/commands/com/send.js");
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
      await (sendCommand as any).handler({
        "from-email": "8de9b6aa-5781-4000-8000-000000000001", // bare UUID
        "to-email": "bob@example.com",
        body: "hi",
      });
    } catch (e) {
      // expected
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    expect(calls.exitCode).toBe(1);
    expect(calls.stderr.join("\n")).toMatch(/--from-email/);
  });
});
