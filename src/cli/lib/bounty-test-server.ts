/**
 * `createBountyTestServer()` — lightweight HTTP test server backed by
 * real BountyRoutes + in-memory Database.
 *
 * Phase: feat/bounty-task-optimize (PR0 — test infra)
 *
 * 设计动机：bounty-task/* 命令未来要走 HTTP 走 `BountyRoutes`。
 * 但 `BountyHTTPServer` 是给 K8s/生产用的（含 WS、IM、SMTP 胶水）。
 * 在单元测试中用不到那么多胶水，需要一个最小化的“只跑 BountyRoutes + AuthRoutes
 * + /health”的内存 server。
 *
 * 行为约定：
 * - `port: 0` → 让 OS 分配空闲端口
 * - `memory: true` 默认 → in-memory SQLite（stop 后数据清空）
 * - `seedAgents` 预创建 agents（id + email + name + credits），便于后续 publish/grab
 * - `authRequired` 默认 false（off 模式 + `X-Agent-Id` 头拿身份），
 *   设为 true → 必须 `Authorization: Bearer <token>` 且 token 在 `validTokens`
 * - 路由覆盖：
 *   - GET  /health
 *   - POST /api/tasks                              (publish)
 *   - PUT  /api/tasks/:id/grab                     (grab)
 *   - PUT  /api/tasks/:id/submit                   (submit)
 *   - PUT  /api/tasks/:id/complete                 (complete)
 *   - PUT  /api/tasks/:id/cancel                   (cancel)
 *   - GET  /api/tasks                              (list)
 *   - GET  /api/tasks/:id                          (get by id)
 *   - GET  /api/agents                             (list seeded agents)
 *
 * 用法：
 *   import { createBountyTestServer } from '../../src/cli/lib/bounty-test-server.js';
 *   const server = await createBountyTestServer({
 *     port: 0,
 *     seedAgents: [{ id: 'pub', email: 'p@x', name: 'P', credits: 1000 }],
 *   });
 *   try {
 *     // exercise bounty CLI / fetch() directly
 *   } finally {
 *     await server.stop();
 *   }
 */

import { Database } from '../../lib/storage/database.js';
import { AgentService } from '../../lib/agent/index.js';
import { BountyRoutes } from '../../server/http/bounty-routes.js';
import { AuthRoutes } from '../../server/http/auth-routes.js';

/** Seeded agent shape accepted by `seedAgents` option. */
export interface SeedAgent {
  id: string;
  email: string;
  name: string;
  credits?: number;
  description?: string;
}

/** Configuration accepted by `createBountyTestServer`. */
export interface BountyTestServerConfig {
  /** TCP port. `0` (default) → OS picks a free port. */
  port?: number;
  /** If true (default), use in-memory SQLite. If false, use file `path`. */
  memory?: boolean;
  /** File path to SQLite database. Ignored when `memory: true`. */
  path?: string;
  /** Pre-create agents so the test can immediately publish / grab / etc. */
  seedAgents?: SeedAgent[];
  /**
   * If true, `Authorization: Bearer <token>` is required for `/api/*`
   * routes, and the token must be in `validTokens`. Default: false.
   */
  authRequired?: boolean;
  /**
   * Whitelisted bearer tokens when `authRequired: true`. The token is
   * opaque — we don't validate JWT signatures; we just check membership.
   */
  validTokens?: string[];
}

/** Returned handle — call `stop()` to tear down the server. */
export interface BountyTestServerHandle {
  /** Actual TCP port the server is listening on. */
  port: number;
  /** Convenience: `http://localhost:PORT`. */
  baseUrl: string;
  /** Underlying in-memory Database (mostly useful for assertions). */
  db: Database;
  /** Stop the server (idempotent). */
  stop(): Promise<void>;
}

/**
 * Start a lightweight bounty test server on the configured port.
 *
 * @throws Error when bind fails (e.g., port already in use)
 */
export async function createBountyTestServer(
  config: BountyTestServerConfig = {}
): Promise<BountyTestServerHandle> {
  const port = config.port ?? 0;
  const memory = config.memory ?? true;
  const authRequired = config.authRequired ?? false;
  const seedAgents = config.seedAgents ?? [];
  const validTokens = new Set(config.validTokens ?? []);

  // ---- DB + routes ----
  const db = new Database(
    memory
      ? { memory: true }
      : { path: config.path ?? ':memory:' }
  );
  const agentService = new AgentService(db);
  seedAgentsInto(db, seedAgents);
  const authRoutes = new AuthRoutes(db);
  const bountyRoutes = new BountyRoutes(db);

  // ---- Bun.serve ----
  let actualPort = port;
  let server: ReturnType<typeof Bun.serve> | null = null;

  server = Bun.serve({
    port,
    fetch: async (req: Request) =>
      handleRequest(req, {
        authRequired,
        validTokens,
        authRoutes,
        bountyRoutes,
        agentService,
      }),
  });
  actualPort = server.port ?? port;

  const handle: BountyTestServerHandle = {
    port: actualPort,
    get baseUrl() {
      return `http://localhost:${actualPort}`;
    },
    db,
    async stop() {
      if (server) {
        try {
          server.stop();
        } catch {
          // already stopped
        }
        server = null;
      }
      try {
        db.close?.();
      } catch {
        // ignore
      }
    },
  };

  // Allow `await server.stop()` syntax; only return once at least one tick
  // has passed (so the OS has bound the port).
  await Promise.resolve();
  return handle;
}

// ====== Internal helpers ======

interface DispatchCtx {
  authRequired: boolean;
  validTokens: Set<string>;
  authRoutes: AuthRoutes;
  bountyRoutes: BountyRoutes;
  agentService: AgentService;
}

async function handleRequest(req: Request, ctx: DispatchCtx): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  // ----- Public health -----
  if (method === 'GET' && path === '/health') {
    return Response.json({ status: 'ok' });
  }

  // ----- Auth gate -----
  if (ctx.authRequired && path.startsWith('/api/')) {
    const auth = req.headers.get('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token || !ctx.validTokens.has(token)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ----- Auth check passed: extract agent identity -----
  // Test convenience: in auth-OFF mode, accept `X-Agent-Id` header so tests
  // don't need real JWTs. In auth-required mode, the bearer token is required
  // above; we still allow `X-Agent-Id` to indicate the acting agent id.
  const headerAgentId = req.headers.get('x-agent-id') ?? req.headers.get('X-Agent-Id') ?? undefined;
  const agentId = headerAgentId ?? '';

  // ----- Auth routes -----
  if (method === 'GET' && path === '/api/agents') {
    return ctx.authRoutes.listAgents();
  }

  // ----- Bounty routes -----
  // Order matters: longest/more-specific patterns first.
  const grabMatch = path.match(/^\/api\/tasks\/([^/]+)\/grab$/);
  const submitMatch = path.match(/^\/api\/tasks\/([^/]+)\/submit$/);
  const completeMatch = path.match(/^\/api\/tasks\/([^/]+)\/complete$/);
  const cancelMatch = path.match(/^\/api\/tasks\/([^/]+)\/cancel$/);
  const taskByIdMatch = path.match(/^\/api\/tasks\/([^/]+)$/);

  if (method === 'GET' && path === '/api/tasks') {
    return ctx.bountyRoutes.getTasks(url);
  }
  if (method === 'POST' && path === '/api/tasks') {
    return await ctx.bountyRoutes.createTask(req, agentId);
  }
  if (method === 'PUT' && grabMatch) {
    return await ctx.bountyRoutes.grabTask(req, grabMatch[1]!, agentId);
  }
  if (method === 'PUT' && submitMatch) {
    return await ctx.bountyRoutes.submitTask(req, submitMatch[1]!, agentId);
  }
  if (method === 'PUT' && completeMatch) {
    return await ctx.bountyRoutes.completeTask(req, completeMatch[1]!, agentId);
  }
  if (method === 'PUT' && cancelMatch) {
    return await ctx.bountyRoutes.cancelTask(req, cancelMatch[1]!, agentId);
  }
  if (method === 'GET' && taskByIdMatch) {
    return ctx.bountyRoutes.getTaskById(taskByIdMatch[1]!);
  }

  return Response.json({ error: 'Not found', path, method }, { status: 404 });
}

function seedAgentsInto(db: Database, seeds: SeedAgent[]): void {
  if (seeds.length === 0) return;
  const now = Date.now();
  const insert = db.prepare(
    `INSERT OR REPLACE INTO agents (id, name, email, description, credits, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  );
  for (const a of seeds) {
    insert.run(
      a.id,
      a.name,
      a.email,
      a.description ?? `seeded by bounty-test-server`,
      a.credits ?? 0,
      now,
      now
    );
  }
}
