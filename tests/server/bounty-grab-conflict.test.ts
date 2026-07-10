/**
 * Tests for `BountyRoutes.grabTask` optimistic-locking semantics (D.1).
 *
 * Phase: feat/bounty-task-optimize (Tier D.1)
 *
 * 设计动机: 两个 agent 并发 grab 同一任务时，DB 层乐观锁（status='open'）
 * 已经保证只有一个赢家。但服务器现在只返 400 + "Task is not open (current
 * status: grabbed)" — 缺少当前 owner 信息，客户端无法友好提示。
 *
 * 修复后：
 * - 第二个 grab → 409 + body 含 `currentOwner` agent-id/email
 * - 客户端看到 409 → 友好提示「任务已被 <email> 抢走」
 *
 * 行为约定：
 *   - DB 层乐观锁已经在 BountyService.grab() 里实现
 *   - 本测试聚焦 server-side HTTP 层：是否正确返 409 + 包含 owner 信息
 *   - 同时保持 401/404 等其他状态码不变
 *
 * 测试场景：
 * 1. 第二次 grab 同任务返 409
 * 2. 409 body 含 currentOwner email
 * 3. 第一次 grab 仍然成功 (200 + task body)
 * 4. 抢自己的任务仍返 400 'Cannot grab your own task'
 * 5. 不存在的任务仍返 404
 * 6. 并发 5 个请求模拟：刚好 1 个成功，4 个 409（race test）
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createBountyTestServer, type BountyTestServerHandle } from '../../src/cli/lib/bounty-test-server.js';

const PUB = 'pub-agent-1';
const GRABBER_A = 'grabber-a';
const GRABBER_B = 'grabber-b';
const BASE_SEEDS = [
  { id: PUB, email: 'pub@test', name: 'Publisher', credits: 1000 },
  { id: GRABBER_A, email: 'grabberA@test', name: 'GrabberA', credits: 0 },
  { id: GRABBER_B, email: 'grabberB@test', name: 'GrabberB', credits: 0 },
];

/**
 * Helper: pre-create a published task (so we can grab it).
 */
async function publishTask(server: BountyTestServerHandle) {
  const res = await fetch(`${server.baseUrl}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agent-Id': PUB },
    body: JSON.stringify({ title: 'Race test task', description: 'd', reward: 100, type: 'coding' }),
  });
  if (res.status !== 201) throw new Error(`publish failed: ${res.status}`);
  return (await res.json()) as { id: string };
}

/**
 * Helper: send a grab request as `agentId`.
 */
async function grab(server: BountyTestServerHandle, taskId: string, agentId: string) {
  return fetch(`${server.baseUrl}/api/tasks/${taskId}/grab`, {
    method: 'PUT',
    headers: { 'X-Agent-Id': agentId },
  });
}

describe('BountyRoutes.grabTask — conflict semantics (D.1)', () => {
  let server: BountyTestServerHandle;

  beforeEach(async () => {
    server = await createBountyTestServer({ port: 0, seedAgents: BASE_SEEDS });
  });

  afterEach(async () => {
    await server.stop();
  });

  test('first grab succeeds with 200 + full task body', async () => {
    const task = await publishTask(server);
    const res = await grab(server, task.id, GRABBER_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; assigneeId: string };
    expect(body.status).toBe('grabbed');
    expect(body.assigneeId).toBe(GRABBER_A);
  });

  test('second grab returns 409 with currentOwner in body', async () => {
    const task = await publishTask(server);
    // First grab wins
    const first = await grab(server, task.id, GRABBER_A);
    expect(first.status).toBe(200);

    // Second grab — should be 409 (conflict), not 400 (generic)
    const second = await grab(server, task.id, GRABBER_B);
    expect(second.status).toBe(409);

    const body = (await second.json()) as { error?: string; currentOwner?: { id?: string; email?: string } };
    expect(body.error).toBeDefined();
    // 必须包含 currentOwner 让客户端能友好提示
    expect(body.currentOwner).toBeDefined();
    expect(body.currentOwner?.id).toBe(GRABBER_A);
    expect(body.currentOwner?.email).toBe('grabberA@test');
  });

  test('grabbing your own task returns 400 with "Cannot grab your own task"', async () => {
    const res1 = await fetch(`${server.baseUrl}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Id': PUB },
      body: JSON.stringify({ title: 'own', description: 'd', reward: 50, type: 'coding' }),
    });
    expect(res1.status).toBe(201);
    const task = (await res1.json()) as { id: string };

    const own = await grab(server, task.id, PUB);
    expect(own.status).toBe(400);
    const body = (await own.json()) as { error: string };
    expect(body.error).toContain('Cannot grab your own task');
  });

  test('grabbing non-existent task returns 404 (not 409)', async () => {
    const res = await grab(server, '00000000-0000-4000-8000-000000000000', GRABBER_A);
    expect(res.status).toBe(404);
  });

  test('race: 5 concurrent grabs → exactly 1 wins (200), 4 lose (409)', async () => {
    const task = await publishTask(server);
    const agents = ['r1', 'r2', 'r3', 'r4', 'r5'];
    // Seed 5 grabbers
    await server.stop();
    server = await createBountyTestServer({
      port: 0,
      seedAgents: [
        ...BASE_SEEDS,
        ...agents.map(id => ({ id, email: `${id}@test`, name: id, credits: 0 })),
      ],
    });
    const task2 = await publishTask(server);

    // Fire all 5 grabs concurrently
    const results = await Promise.all(
      agents.map(a => grab(server, task2.id, a))
    );

    const winners = results.filter(r => r.status === 200);
    const losers = results.filter(r => r.status === 409);
    expect(winners.length).toBe(1);
    expect(losers.length).toBe(4);

    // Each loser's body should contain the winner's id
    const winnerResp = await winners[0]!.json() as { assigneeId: string };
    const winnerId = winnerResp.assigneeId;

    for (const r of losers) {
      const body = (await r.json()) as { currentOwner?: { id: string } };
      expect(body.currentOwner?.id).toBe(winnerId);
    }
  });
});
