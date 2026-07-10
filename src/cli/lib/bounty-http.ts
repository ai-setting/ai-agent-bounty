/**
 * Shared HTTP client wrapper for bounty-task/* CLI commands.
 *
 * Phase: feat/bounty-task-optimize
 *
 * 设计动机: 6 个 bounty-task 子命令（publish/grab/board/submit/complete/cancel）
 * 都要发 HTTP 请求到 /api/tasks/*。每个命令重复拼 URL / 加 header / 处理错误
 * 太冗余。这个模块统一封装：
 *
 *   - baseUrl 拼接（base + path，自动 trim 末尾 /、补齐开头 /）
 *   - 自动从 ~/.config/bounty/token 读 JWT 加 Authorization header
 *   - 抛 `BountyHttpError`（带 status / type / friendlyMessage），让上层
 *     统一处理网络 / 鉴权 / 业务 / 服务端错误
 *   - 自动重试 transient 失败（网络错误、502/503/504），指数退避 + jitter
 *
 * 错误分类：
 *   - `type=network` — fetch() 本身 reject（连接拒绝、超时等）
 *   - `type=auth`   — HTTP 401 / 403（鉴权失败 / 越权）
 *   - `type=business` — HTTP 400 / 404（业务校验失败）
 *   - `type=server` — HTTP 5xx（服务端错误）
 *
 * 用法：
 *   import { bountyHttp, BountyHttpError } from '../lib/bounty-http.js';
 *   try {
 *     const task = await bountyHttp({
 *       baseUrl: 'http://localhost:4000',
 *       path: '/api/tasks',
 *       method: 'POST',
 *       body: { title, description, reward },
 *     });
 *     console.log('Published:', task.id);
 *   } catch (e) {
 *     if (e instanceof BountyHttpError) {
 *       console.error(e.message);
 *       process.exit(e.type === 'auth' ? 3 : 2);
 *     }
 *     throw e;
 *   }
 */

import { readAuthToken, DEFAULT_TOKEN_PATH } from './auth-token.js';
import { bountyFetch } from './fetch-helper.js';

/**
 * Error type classification — helps CLI handlers decide exit codes
 * and print user-friendly messages.
 */
export type BountyHttpErrorType = 'network' | 'auth' | 'business' | 'server';

/**
 * Structured HTTP error thrown by `bountyHttp()`.
 *
 * Always thrown (never returned) when a request fails for any reason.
 */
export class BountyHttpError extends Error {
  readonly type: BountyHttpErrorType;
  readonly status: number;
  /** Raw server-provided error message (if available) */
  readonly serverMessage: string | undefined;
  /** When present, info about the entity currently holding the resource (e.g., grab conflict). */
  readonly currentOwner:
    | { id?: string; email?: string; name?: string }
    | undefined;
  /** Server-provided current status (e.g., 'grabbed', 'completed'). */
  readonly currentStatus: string | undefined;

  constructor(
    type: BountyHttpErrorType,
    status: number,
    message: string,
    serverMessage?: string,
    extra?: {
      currentOwner?: { id?: string; email?: string; name?: string };
      currentStatus?: string;
    }
  ) {
    super(message);
    this.name = 'BountyHttpError';
    this.type = type;
    this.status = status;
    this.serverMessage = serverMessage;
    this.currentOwner = extra?.currentOwner;
    this.currentStatus = extra?.currentStatus;
  }
}

export interface BountyHttpOptions {
  /** Base URL with scheme (e.g., http://localhost:4000). Trailing slash is auto-trimmed. */
  baseUrl: string;
  /** API path, with or without leading slash (e.g., /api/tasks). */
  path: string;
  /** HTTP method (default: GET) */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Request body (will be JSON.stringify'd). Only used for non-GET/HEAD methods. */
  body?: unknown;
  /**
   * Token file path override. Defaults to ~/.config/bounty/token.
   * Pass explicit path in tests to avoid touching real ~/.
   */
  tokenPath?: string;
  /**
   * AbortSignal for request cancellation / timeout.
   * Caller is responsible for setting up the AbortController.
   */
  signal?: AbortSignal;
  /**
   * Optional request timeout in milliseconds. Implemented via AbortController.
   * Default: 30000 (30s).
   */
  timeoutMs?: number;
  /**
   * Max retry attempts for transient failures (network errors, 502/503/504).
   * Default: 2. Set to 0 to disable retry.
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for exponential backoff.
   * First retry waits ~baseDelayMs, second waits ~2*baseDelayMs, etc.
   * Default: 200ms.
   */
  retryBaseDelayMs?: number;
  /**
   * Extra HTTP headers to include in the request. Merged into the
   * default Content-Type + Authorization headers; caller headers win
   * on key conflict (so callers can override).
   *
   * Use case: Idempotency-Key, X-Trace-Id, X-Client-Version, etc.
   */
  extraHeaders?: Record<string, string>;
}

/** HTTP status codes that should trigger automatic retry. */
const RETRYABLE_STATUS_CODES = new Set([502, 503, 504]);

/**
 * Compute backoff delay for a given attempt index with jitter.
 * attempt=0 (first retry) → baseDelay
 * attempt=1 → baseDelay * 2
 * attempt=2 → baseDelay * 4
 * + up to ±25% jitter to avoid thundering herd
 */
function computeBackoffMs(attempt: number, baseDelayMs: number): number {
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1); // ±25%
  return Math.max(0, Math.floor(exponential + jitter));
}

/**
 * Sleep for ms milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Classify an HTTP status into a BountyHttpErrorType.
 */
function classifyStatus(status: number): BountyHttpErrorType {
  if (status === 401 || status === 403) return 'auth';
  if (status === 400 || status === 404 || status === 409 || status === 422) return 'business';
  if (status >= 500) return 'server';
  return 'business';
}

/**
 * Build a friendly error message for a given status + server message.
 */
function buildFriendlyMessage(type: BountyHttpErrorType, status: number, serverMessage: string | undefined, url: string): string {
  if (type === 'auth') {
    return (
      `Authentication required (HTTP ${status}). ` +
      `Run \`bounty auth login\` or check BOUNTY_API_URL. ` +
      (serverMessage ? `Server: ${serverMessage}` : '')
    );
  }
  if (type === 'server') {
    return (
      `Bounty server error (HTTP ${status}). ` +
      `The server may be misconfigured or under load. ` +
      (serverMessage ? `Server: ${serverMessage}` : '') +
      ` URL: ${url}`
    );
  }
  // business
  return `Request failed (HTTP ${status}): ${serverMessage ?? 'unknown error'}`;
}

/**
 * Execute a single HTTP attempt (no retry).
 * Returns the parsed JSON body on 2xx.
 * Throws BountyHttpError on non-2xx or network failure.
 */
async function executeOnce<T>(
  url: string,
  method: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  urlForError: string
): Promise<T> {
  // Timeout: set up AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (callerSignal) {
    callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  let response: Response;
  try {
    response = await bountyFetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err?.name === 'AbortError') {
      throw new BountyHttpError(
        'network',
        0,
        `Request timeout after ${timeoutMs}ms — bounty server may be unreachable. URL: ${urlForError}`
      );
    }
    throw new BountyHttpError(
      'network',
      0,
      `Network error: ${err instanceof Error ? err.message : String(err)}. ` +
        `Is the bounty server running? Try: bounty server start. URL: ${urlForError}`
    );
  }
  clearTimeout(timeoutId);

  // 处理非 2xx
  if (!response.ok) {
    let serverMessage: string | undefined;
    let currentOwner: { id?: string; email?: string; name?: string } | undefined;
    let currentStatus: string | undefined;
    try {
      const data: any = await response.json();
      serverMessage = data?.error;
      currentOwner = data?.currentOwner;
      currentStatus = data?.currentStatus;
    } catch {
      try {
        serverMessage = await response.text();
      } catch {
        serverMessage = undefined;
      }
    }

    const type = classifyStatus(response.status);
    const friendly = buildFriendlyMessage(type, response.status, serverMessage, urlForError);
    throw new BountyHttpError(type, response.status, friendly, serverMessage, {
      currentOwner,
      currentStatus,
    });
  }

  // 2xx — parse JSON
  try {
    return (await response.json()) as T;
  } catch (err: any) {
    throw new BountyHttpError(
      'server',
      response.status,
      `Failed to parse server response as JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/**
 * Issue an HTTP request to the bounty server with automatic retry on
 * transient failures.
 *
 * Retry behavior:
 * - Network errors (fetch reject): retryable
 * - HTTP 502 / 503 / 504: retryable
 * - Other HTTP errors (400, 401, 404, 500 other): not retryable
 * - 2xx success: no retry
 *
 * @throws {BountyHttpError} when the request ultimately fails (after retries)
 */
export async function bountyHttp<T = unknown>(options: BountyHttpOptions): Promise<T> {
  const {
    baseUrl,
    path,
    method = 'GET',
    body,
    tokenPath = DEFAULT_TOKEN_PATH,
    agentId,
    signal,
    timeoutMs = 30000,
    maxRetries = 2,
    retryBaseDelayMs = 200,
  } = options;

  // URL 拼接: trim 末尾 /，确保 path 以 / 开头
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${trimmedBase}${normalizedPath}`;

  // Headers: Content-Type + Authorization (如 token 存在) + X-Agent-Id (dev mode)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = readAuthToken(tokenPath);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (agentId) {
    headers['X-Agent-Id'] = agentId;
  }
  // Merge caller-provided extra headers last so they win on key conflict
  if (options.extraHeaders) {
    for (const [key, value] of Object.entries(options.extraHeaders)) {
      headers[key] = value;
    }
  }

  let lastError: BountyHttpError | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await executeOnce<T>(url, method, headers, body, timeoutMs, signal, url);
    } catch (err: any) {
      if (!(err instanceof BountyHttpError)) {
        // 未知错误 — 不重试
        throw err;
      }
      // 判断是否可重试
      const isNetwork = err.type === 'network';
      const isRetryableStatus = err.status > 0 && RETRYABLE_STATUS_CODES.has(err.status);
      const isRetryable = isNetwork || isRetryableStatus;

      if (!isRetryable || attempt === maxRetries) {
        throw err;
      }

      lastError = err;
      const delay = computeBackoffMs(attempt, retryBaseDelayMs);
      await sleep(delay);
    }
  }

  // Should be unreachable because the loop either returns or throws
  throw lastError ?? new BountyHttpError('network', 0, 'Unexpected: retry loop exited without throwing');
}