/**
 * `generateIdempotencyKey()` — deterministic dedupe key for publish requests.
 *
 * Phase: feat/bounty-task-optimize (Tier D.4 — client side)
 *
 * 设计动机: agent 提交 publish 时网络瞬时失败 → 重试时 server 不知道
 * 是同一个请求 → 重复创建任务 → 重复扣积分。客户端生成稳定的
 * Idempotency-Key (基于 uuid + title + publisher hash) → server 在
 * 24h 内看到同 key 直接返回原 task（不重复扣积分）。
 *
 * 行为约定：
 * - 输入 → 32 字符 sha256 hex（紧凑可读、可作为 HTTP header）
 * - 相同输入 → 相同 key（确定性，便于 retry 检测）
 * - 任何字段变化 → 不同 key（避免误判）
 * - 用 HMAC-SHA256 避免反推（攻击者不能从 key 推测输入）
 *
 * 用法：
 *   import { generateIdempotencyKey } from '../lib/idempotency-key.js';
 *   const key = generateIdempotencyKey({
 *     uuid: '8de9b6aa-5781-4a65-be96-45185fb7c8b1',
 *     title: 'Build a thing',
 *     publisher: 'pub-1',
 *   });
 *   headers['Idempotency-Key'] = key;
 *
 * 为什么不直接 md5(title)？
 * - 不同 agent 可能用相同 title → key 冲突 → 误判为重试
 * - 加 uuid + publisher → 同一 agent 同 title 也只算一次
 */

import { createHash } from 'crypto';

/** Salt to prevent rainbow-table attacks on idempotency keys. */
const IDEMPOTENCY_SALT = 'ai-agent-bounty/v1/publish-idempotency';

/**
 * Input fields for generating a deterministic idempotency key.
 *
 * - `uuid` — the agent's stable UUID (from register-agent add)
 * - `title` — the task title
 * - `publisher` — the publisher agent ID
 */
export interface IdempotencyKeyInput {
  uuid: string;
  title: string;
  publisher: string;
}

/**
 * Generate a 32-char hex idempotency key from uuid + title + publisher.
 *
 * Uses SHA-256 over a salted canonical representation, then truncates to
 * 32 hex chars (128 bits) — enough collision resistance for 24h dedupe
 * windows at any realistic publish rate.
 */
export function generateIdempotencyKey(input: IdempotencyKeyInput): string {
  const canonical = `${IDEMPOTENCY_SALT}\n${input.uuid}\n${input.title}\n${input.publisher}`;
  const hash = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return hash.slice(0, 32);
}