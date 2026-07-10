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

  constructor(
    type: BountyHttpErrorType,
    status: number,
    message: string,
    serverMessage?: string
  ) {
    super(message);
    this.name = 'BountyHttpError';
    this.type = type;
    this.status = status;
    this.serverMessage = serverMessage;
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
}

/**
 * Issue an HTTP request to the bounty server.
 *
 * @throws {BountyHttpError} when the request fails (network, auth, business, server)
 */
export async function bountyHttp<T = unknown>(options: BountyHttpOptions): Promise<T> {
  const {
    baseUrl,
    path,
    method = 'GET',
    body,
    tokenPath = DEFAULT_TOKEN_PATH,
    signal,
    timeoutMs = 30000,
  } = options;

  // URL 拼接: trim 末尾 /，确保 path 以 / 开头
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = `${trimmedBase}${normalizedPath}`;

  // Headers: Content-Type + Authorization (如 token 存在)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const token = readAuthToken(tokenPath);
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // Timeout: set up AbortController
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  // If caller already has an AbortSignal, wire it up
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
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
        `Request timeout after ${timeoutMs}ms — bounty server may be unreachable. URL: ${url}`
      );
    }
    throw new BountyHttpError(
      'network',
      0,
      `Network error: ${err instanceof Error ? err.message : String(err)}. ` +
        `Is the bounty server running at ${baseUrl}? Try: bounty server start`
    );
  }
  clearTimeout(timeoutId);

  // 处理非 2xx
  if (!response.ok) {
    let serverMessage: string | undefined;
    try {
      const data: any = await response.json();
      serverMessage = data?.error;
    } catch {
      // response 不是 JSON — 读 raw text
      try {
        serverMessage = await response.text();
      } catch {
        serverMessage = undefined;
      }
    }

    // 分类
    let type: BountyHttpErrorType;
    if (response.status === 401 || response.status === 403) {
      type = 'auth';
    } else if (response.status === 400 || response.status === 404 || response.status === 409 || response.status === 422) {
      type = 'business';
    } else if (response.status >= 500) {
      type = 'server';
    } else {
      type = 'business';
    }

    const friendly =
      type === 'auth'
        ? `Authentication required (HTTP ${response.status}). ` +
          `Run \`bounty auth login\` or check BOUNTY_API_URL. ` +
          (serverMessage ? `Server: ${serverMessage}` : '')
        : type === 'server'
        ? `Bounty server error (HTTP ${response.status}). ` +
          `The server may be misconfigured or under load. ` +
          (serverMessage ? `Server: ${serverMessage}` : '')
        : `Request failed (HTTP ${response.status}): ${serverMessage ?? response.statusText ?? 'unknown error'}`;

    throw new BountyHttpError(type, response.status, friendly, serverMessage);
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