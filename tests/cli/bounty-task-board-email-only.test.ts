/**
 * v0.14 strict email-only contract tests for `bounty bounty-task board`.
 *
 * Board is a read-only listing command — it does NOT carry actor identity
 * in its body. This test asserts that no legacy identity flag ever
 * sneaks into board.ts during future refactors.
 *
 * v0.14 contract:
 *   - No --agent-address, --agent-id, --publisher-address flags.
 *   - If a publisher filter is added (e.g. ?publisherEmail=), it MUST
 *     be email-shaped, not address-shaped.
 */

import { describe, test, expect } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const BOARD_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/bounty-task/board.ts",
);

describe("bounty-task board — v0.14 strict email-only (no-op guarantee)", () => {
  test("T1: no legacy actor identity flag in board.ts", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"](agent-address|agent-id|publisher-address|publisher-id)['"]/);
  });

  test("T2: no BOUNTY_IM_ADDRESS env fallback in board.ts", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
  });

  test("T3: no resolveCurrentAgentAddress / resolveAddressOption in board.ts", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
    expect(src).not.toMatch(/resolveAddressOption/);
  });

  test("T4: board is a pure HTTP GET to /api/tasks", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).toMatch(/\/api\/tasks/);
    expect(src).toMatch(/method:\s*['"]GET['"]/);
  });
});
