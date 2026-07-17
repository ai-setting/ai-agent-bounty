/**
 * v0.14 strict email-only contract tests for `bounty bounty-task board`
 * with optional `--publisher-email` filter (Phase 4 R-2).
 *
 * Contract:
 *   - `--publisher-email` is the ONLY actor-identity filter; the CLI
 *     forwards it as `?publisherId=<email>` (email-shaped, not address-shaped).
 *   - Reject `<uuid>@<host>` and bare UUIDs in `--publisher-email`.
 *   - Server-side validation lives in `/api/tasks` query handling
 *     (tested separately in `tests/server/bounty-routes.test.ts`).
 *
 * The previous "no-op" test asserted board never takes identity —
 * the v0.14 strict contract now allows the OPTIONAL publisher-email
 * filter (a publisher might want to see only their own open tasks),
 * but the filter must itself be an email.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";

const BOARD_SRC = resolve(
  import.meta.dir,
  "../../src/cli/commands/bounty-task/board.ts",
);

interface FakeBountyTask {
  id: string;
  title: string;
  type: string;
  reward: number;
  status: string;
  publisherEmail?: string;
}

describe("bounty-task board — v0.14 strict publisher-email filter (RED R-2)", () => {
  let origFetch: typeof fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  // ============ Static source assertions ============

  test("T1 (static): board.ts exposes --publisher-email filter option", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).toMatch(/\.option\(\s*['"]publisher-email['"]/);
  });

  test("T2 (static): board.ts uses the requireEmailFlag helper for validation", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).toMatch(/from\s+['"][^'"]*email-flag\.js['"]/);
    expect(src).toMatch(/requireEmailFlag/);
  });

  test("T3 (static): board.ts forwards validated email as publisherId query (not publisherAddress)", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    // Forward the email to the existing publisherId server filter,
    // but also explicitly set `publisherId=` to the validated email.
    expect(src).toMatch(/publisherId\s*=/);
    // v0.14 forbids forwarding `<uuid>@<host>` strings anywhere on the wire.
    expect(src).not.toMatch(/publisherAddress\s*[:=]/);
  });

  test("T4 (static): no legacy flag preserved in board.ts", () => {
    const src = readFileSync(BOARD_SRC, "utf-8");
    expect(src).not.toMatch(/\.option\(\s*['"](agent-address|agent-id|publisher-address|publisher-id)['"]/);
    expect(src).not.toMatch(/BOUNTY_IM_ADDRESS/);
    expect(src).not.toMatch(/resolveCurrentAgentAddress/);
  });

  // ============ Integration / runtime assertions ============

  test("T5 (integration): --publisher-email forwards publisherId=<email> query", async () => {
    const { boardCommand } = await import(
      "../../src/cli/commands/bounty-task/board.js"
    );

    const seen: { url: string; method: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      seen.push({ url, method: init?.method ?? "GET" });
      return new Response(
        JSON.stringify([
          {
            id: "8de9b6aa-5781-4a65-be96-45185fb7c8b1",
            title: "demo",
            type: "coding",
            reward: 10,
            status: "open",
            publisherEmail: "alice@example.com",
          },
        ] as FakeBountyTask[]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const origLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a ?? "")).join(" "));
    };

    try {
      await (boardCommand as any).handler({
        "publisher-email": "alice@example.com",
        "server-url": "http://127.0.0.1:4000",
      });
    } finally {
      console.log = origLog;
    }

    expect(seen.length).toBe(1);
    const callUrl = new URL(seen[0].url);
    expect(callUrl.pathname).toBe("/api/tasks");
    expect(callUrl.searchParams.get("publisherId")).toBe("alice@example.com");
  });

  test("T6 (integration): bare UUID in --publisher-email is rejected with exit 1", async () => {
    const { boardCommand } = await import(
      "../../src/cli/commands/bounty-task/board.js"
    );

    const captured: { exitCode: number | null; stderr: string[] } = {
      exitCode: null,
      stderr: [],
    };
    const origExit = process.exit;
    const origErr = console.error;
    let exitCalled = false;
    (process as any).exit = (code?: number) => {
      captured.exitCode = code ?? 0;
      exitCalled = true;
      throw new Error(`exit-${code}`);
    };
    console.error = (...args: unknown[]) => {
      captured.stderr.push(String(args[0] ?? ""));
    };

    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return new Response("[]", { status: 200 });
    }) as typeof fetch;

    try {
      await (boardCommand as any).handler({
        "publisher-email": "8de9b6aa-5781-4000-8000-000000000001", // bare UUID
        "server-url": "http://127.0.0.1:4000",
      });
    } catch (e) {
      // expected
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    expect(exitCalled).toBe(true);
    expect(captured.exitCode).toBe(1);
    expect(fetchCalled).toBe(false);
    const combined = captured.stderr.join("\n");
    expect(combined).toMatch(/--publisher-email/);
  });

  test("T7 (integration): <uuid>@<host> in --publisher-email is rejected", async () => {
    const { boardCommand } = await import(
      "../../src/cli/commands/bounty-task/board.js"
    );

    const captured: { exitCode: number | null } = { exitCode: null };
    const origExit = process.exit;
    const origErr = console.error;
    (process as any).exit = (code?: number) => {
      captured.exitCode = code ?? 0;
      throw new Error(`exit-${code}`);
    };
    console.error = () => {};

    try {
      await (boardCommand as any).handler({
        "publisher-email":
          "8de9b6aa-5781-4000-8000-000000000001@bounty.local",
        "server-url": "http://127.0.0.1:4000",
      });
    } catch (e) {
      // expected
    } finally {
      (process as any).exit = origExit;
      console.error = origErr;
    }

    expect(captured.exitCode).toBe(1);
  });

  test("T8 (integration): omitting --publisher-email works without identity (board is open listing)", async () => {
    const { boardCommand } = await import(
      "../../src/cli/commands/bounty-task/board.js"
    );

    const seen: { url: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      seen.push({ url });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const origLog = console.log;
    const logs: string[] = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.map((a) => String(a ?? "")).join(" "));
    };

    try {
      await (boardCommand as any).handler({
        "server-url": "http://127.0.0.1:4000",
      });
    } finally {
      console.log = origLog;
    }

    expect(seen.length).toBe(1);
    const callUrl = new URL(seen[0].url);
    expect(callUrl.pathname).toBe("/api/tasks");
    // Without --publisher-email, publisherId should NOT be in the query.
    expect(callUrl.searchParams.get("publisherId")).toBeNull();
    // status=open MUST be the default for board
    expect(callUrl.searchParams.get("status")).toBe("open");
  });
});
