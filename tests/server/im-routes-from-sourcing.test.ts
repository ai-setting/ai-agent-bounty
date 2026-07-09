/**
 * Phase 4: im-routes.sendMessage from-sourcing logic when token check off
 *
 * 验证:
 * - token check off (no Authorization header, requester=undefined): from = body.from (legacy)
 * - token check on (Authorization valid, requester.agentId 存在): from = `${agentId}@authenticated`
 * - token check off + requester 存在但 agentId undefined (理论上不应该发生, 但保持稳健):
 *   from = body.from (不输出 "undefined@authenticated")
 */

import { describe, test, expect } from 'bun:test';
import { IMRoutes } from '../../src/server/http/im-routes.js';
import { Database } from 'bun:sqlite';

describe('Phase 4: from-sourcing on /api/messages', () => {
  test('token check off (no Authorization): from = body.from', async () => {
    const imDb = new Database(':memory:') as any;
    // Create im_messages table
    imDb.exec(`
      CREATE TABLE IF NOT EXISTS im_messages (
        id TEXT PRIMARY KEY, from_address TEXT, to_address TEXT,
        content TEXT, status TEXT, created_at TEXT,
        delivered_at TEXT, acked_at TEXT
      );
    `);

    let savedMessage: any = null;
    imDb.saveMessage = (msg: any) => {
      savedMessage = msg;
    };
    imDb.updateMessageStatus = () => {};
    const imRoutes = new IMRoutes(imDb);

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'caller@example.com',
        to: 'recipient@example.com',
        content: { type: 'text', body: 'hello' },
      }),
    });

    await imRoutes.sendMessage(req); // no requester = undefined

    expect(savedMessage.from).toBe('caller@example.com'); // ← legacy path
    expect(savedMessage.from).not.toContain('@authenticated');
  });

  test('token check on (Authorization valid): from = `${agentId}@authenticated`', async () => {
    const imDb = new Database(':memory:') as any;
    imDb.exec(`
      CREATE TABLE IF NOT EXISTS im_messages (
        id TEXT PRIMARY KEY, from_address TEXT, to_address TEXT,
        content TEXT, status TEXT, created_at TEXT,
        delivered_at TEXT, acked_at TEXT
      );
    `);
    let savedMessage: any = null;
    imDb.saveMessage = (msg: any) => { savedMessage = msg; };
    imDb.updateMessageStatus = () => {};
    const imRoutes = new IMRoutes(imDb);

    const req = new Request('http://localhost/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'should-be-ignored@example.com',
        to: 'recipient@example.com',
        content: { type: 'text', body: 'hello' },
      }),
    });

    await imRoutes.sendMessage(req, { agentId: 'real-agent-id-abc123' });

    expect(savedMessage.from).toBe('real-agent-id-abc123@authenticated');
  });
});
