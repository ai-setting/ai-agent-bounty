/**
 * v0.14 strict email-only contract tests for `bounty bounty-task publish`.
 *
 * Contract (publish is special because publisher identity is a rename):
 *   - `--publisher-email / -e` is the ONLY publisher identity flag.
 *   - `--publisher-address / -p` is REMOVED entirely (renamed to --publisher-email).
 *   - `BOUNTY_IM_ADDRESS` env fallback REMOVED.
 *   - `--publisher-email` with <uuid>@<host>, bare UUIDs, malformed rejected with exit 1.
 *   - HTTP body uses {publisherEmail} ONLY (no publisherAddress key).
 *   - X-Agent-Id soft-auth header REMOVED (no longer needed with strict email body).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const PUBLISH_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/bounty-task/publish.ts",
);

describe("bounty-task publish — v0.14 strict email-only", () => {
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

  test("T1 (static): --publisher-address option is REMOVED from publish.ts", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"]publisher-address['"]/);
    expect(src).not.toMatch(/['"]publisher-address['"]\s*:\s*\{/);
  });

  test("T2 (static): --publisher-email / -e option is PRESENT", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    expect(src).toMatch(/\.option\(\s*['"]publisher-email['"]/);
    // The option block must declare alias 'e' (or -e).
    expect(src).toMatch(/['"]publisher-email['"][\s\S]{0,200}alias:\s*['"]e['"]/);
  });

  test("T3 (static): resolveCurrentAgentAddress NOT imported/used in publish.ts", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });

  test("T4 (static): legacy env fallback string NOT referenced in publish.ts", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
  });

  test("T5 (static): publish.ts uses the shared requireEmailFlag helper from email-flag.js", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    // v0.14.0 (Phase 4 R-1): centralised via the requireEmailFlag helper.
    expect(src).toMatch(/from\s+['"][^'"]*email-flag\.js['"]/);
    expect(src).toMatch(/requireEmailFlag/);
    // No direct parseEmail call (use the helper, not the boundary directly).
    expect(src).not.toMatch(/parseEmail\s*\(/);
  });

  test("T6 (static): body uses publisherEmail ONLY (no publisherAddress key)", () => {
    const src = readFileSync(PUBLISH_SRC, "utf-8");
    expect(src).not.toMatch(/publisherAddress\s*[:=]/);
  });

  test("T7 (integration): --publisher-email with bare UUID exits 1 + --email hint", async () => {
    const { publishCommand } = await import(
      "../../src/cli/commands/bounty-task/publish.js"
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
      await (publishCommand as any).handler({
        title: "Test task",
        type: "coding",
        reward: 100,
        "publisher-email": "8de9b6aa-5781-4000-8000-000000000001", // bare UUID
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
    expect(combined).toMatch(/--publisher-email/);
  });
});
