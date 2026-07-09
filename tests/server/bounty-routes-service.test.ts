/**
 * Bounty Routes must use BountyService (H1)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';

vi.mock('../../src/auth/mailer.js', () => ({
  sendVerificationEmail: vi.fn().mockResolvedValue(undefined)
}));

import { BountyHTTPServer } from '../../src/server/http';
import { IMDatabase } from '../../src/im/db';
import { Database } from '../../src/lib/storage/database';

describe('Bounty Routes use BountyService (H1)', () => {
  let imDb: IMDatabase;
  let bountyDb: Database;
  let server: BountyHTTPServer;
  let baseUrl: string;
  let publisherToken: string;
  let grabberToken: string;

  async function registerAndVerify(email: string, name: string): Promise<string> {
    const reg = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name }),
    });
    expect(reg.status).toBe(200);
    const regBody = await reg.json() as { agent_id: string; status: string };

    // Verification codes are persisted server-side, not returned via API.
    const verification = bountyDb
      .prepare('SELECT code FROM verifications WHERE email = ?')
      .get(email) as { code: string };
    expect(verification).toBeTruthy();

    const ver = await fetch(`${baseUrl}/api/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code: verification.code }),
    });
    expect(ver.status).toBe(200);

    const login = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    expect(login.status).toBe(200);
    const loginBody = await login.json() as { token: string };
    return loginBody.token;
  }

  beforeEach(async () => {
    // 此 test 期望 token check ON 行为 (baseline 401/403 路径)
    process.env.BOUNTY_TOKEN_CHECK_ENABLED = "true";
    imDb = new IMDatabase({ memory: true });
    bountyDb = new Database({ memory: true });
    server = new BountyHTTPServer({ imDb, bountyDb, port: 0 });
    await server.start();
    baseUrl = `http://localhost:${server.getPort()}`;


    publisherToken = await registerAndVerify('publisher@example.com', 'Publisher');
    grabberToken = await registerAndVerify('grabber@example.com', 'Grabber');
  });

  afterEach(() => {
    server.stop();
  });

  it('POST /api/tasks deducts publisher credits and creates an escrow via BountyService', async () => {
    // Capture publisher credits before
    const pubBefore = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${publisherToken}` },
    })).json() as { credits: number }).credits;

    const reward = 30;
    const res = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({ title: 'T1', description: 'D1', reward, type: 'coding' }),
    });
    expect(res.status).toBe(201);
    const created = await res.json() as { id: string; status: string; reward: number };
    expect(created.id).toBeTruthy();
    expect(created.status).toBe('open');

    // Credits should be deducted (rewards granted as 100 to new agents)
    const pubAfter = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${publisherToken}` },
    })).json() as { credits: number }).credits;
    expect(pubAfter).toBe(pubBefore - reward);

    // An escrow row should now exist
    const escrowRow = bountyDb
      .prepare('SELECT * FROM escrows WHERE task_id = ?')
      .get(created.id) as { status: string; amount: number };
    expect(escrowRow).toBeTruthy();
    expect(escrowRow.amount).toBe(reward);
    expect(escrowRow.status).toBe('locked');
  });

  it('PUT /api/tasks/:id/grab transitions to grabbed via BountyService.grab()', async () => {
    const reward = 20;
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({ title: 'TG', description: 'DG', reward, type: 'coding' }),
    });
    const task = await create.json() as { id: string };

    const grab = await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${grabberToken}` },
    });
    expect(grab.status).toBe(200);
    const updated = await grab.json() as { status: string; assigneeId: string };
    expect(updated.status).toBe('grabbed');
    expect(updated.assigneeId).toBeTruthy();
  });

  it('PUT /api/tasks/:id/complete releases credits to assignee (new endpoint)', async () => {
    const reward = 25;
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({ title: 'TC', description: 'DC', reward, type: 'coding' }),
    });
    const task = await create.json() as { id: string };

    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${grabberToken}` },
    });
    await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${grabberToken}`,
      },
      body: JSON.stringify({ result: 'done' }),
    });

    const grabberBefore = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${grabberToken}` },
    })).json() as { credits: number }).credits;

    const complete = await fetch(`${baseUrl}/api/tasks/${task.id}/complete`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${publisherToken}` },
    });
    expect(complete.status).toBe(200);
    const updated = await complete.json() as { status: string };
    expect(updated.status).toBe('completed');

    const grabberAfter = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${grabberToken}` },
    })).json() as { credits: number }).credits;
    expect(grabberAfter).toBe(grabberBefore + reward);
  });

  it('PUT /api/tasks/:id/cancel refunds publisher when open (new endpoint)', async () => {
    const reward = 15;
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({ title: 'TC2', description: 'D2', reward, type: 'coding' }),
    });
    const task = await create.json() as { id: string };

    const pubBefore = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${publisherToken}` },
    })).json() as { credits: number }).credits;

    const cancel = await fetch(`${baseUrl}/api/tasks/${task.id}/cancel`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${publisherToken}` },
    });
    expect(cancel.status).toBe(200);
    const updated = await cancel.json() as { status: string };
    expect(updated.status).toBe('cancelled');

    const pubAfter = (await (await fetch(`${baseUrl}/api/agents/me/credits`, {
      headers: { Authorization: `Bearer ${publisherToken}` },
    })).json() as { credits: number }).credits;
    expect(pubAfter).toBe(pubBefore + reward);
  });

  it('PUT /api/tasks/:id/dispute moves task to disputed (new endpoint)', async () => {
    const reward = 10;
    const create = await fetch(`${baseUrl}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}`,
      },
      body: JSON.stringify({ title: 'TD', description: 'DD', reward, type: 'coding' }),
    });
    const task = await create.json() as { id: string };

    await fetch(`${baseUrl}/api/tasks/${task.id}/grab`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${grabberToken}` },
    });
    await fetch(`${baseUrl}/api/tasks/${task.id}/submit`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${grabberToken}` },
      body: JSON.stringify({ result: 'maybe' }),
    });

    const dispute = await fetch(`${baseUrl}/api/tasks/${task.id}/dispute`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${publisherToken}` },
      body: JSON.stringify({ reason: 'not satisfied' }),
    });
    expect(dispute.status).toBe(200);
    const updated = await dispute.json() as { status: string };
    expect(updated.status).toBe('disputed');
  });
});
