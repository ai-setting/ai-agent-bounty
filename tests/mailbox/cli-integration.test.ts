/**
 * CLI Integration Test for Mailbox Service
 * Verifies the mailbox service works end-to-end with the CLI
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { Database } from '../../src/lib/storage/database';
import { EventBus } from '../../src/lib/mailbox/event-bus';
import { MailboxService } from '../../src/lib/mailbox/mailbox-service';
import { HTTPServer } from '../../src/lib/mailbox/http-server';

describe('Mailbox CLI Integration', () => {
  let db: Database;
  let eventBus: EventBus;
  let service: MailboxService;
  let server: HTTPServer;
  let port = 3800;

  beforeAll(async () => {
    db = new Database({ memory: true });
    eventBus = new EventBus();
    service = new MailboxService(db, eventBus);
    server = new HTTPServer(service, port);
    await server.start();
  });

  afterAll(() => {
    server.stop();
    db.close();
  });

  it('should complete end-to-end CLI workflow', async () => {
    // Step 1: Register Agent A
    const resA = await fetch(`http://localhost:${port}/api/v1/mail/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-a', name: 'AgentA' }),
    });
    expect(resA.status).toBe(201);
    const addrA = await resA.json();
    expect(addrA.address).toBe('agenta@local');

    // Step 2: Register Agent B
    const resB = await fetch(`http://localhost:${port}/api/v1/mail/addresses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'agent-b', name: 'AgentB' }),
    });
    expect(resB.status).toBe(201);
    const addrB = await resB.json();
    expect(addrB.address).toBe('agentb@local');

    // Step 3: Agent A sends message to Agent B
    const sendRes = await fetch(`http://localhost:${port}/api/v1/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fromAddress: addrA.address,
        toAddress: addrB.address,
        subject: 'Bounty Task Available',
        body: 'Hey AgentB, there is a new bounty task available for you!',
      }),
    });
    expect(sendRes.status).toBe(201);
    const sentMsg = await sendRes.json();
    expect(sentMsg.status).toBe('sent');

    // Step 4: Agent B checks inbox
    const inboxRes = await fetch(`http://localhost:${port}/api/v1/mail/inbox?address=${addrB.address}`);
    const inbox = await inboxRes.json();
    expect(inbox.length).toBe(1);
    expect(inbox[0].subject).toBe('Bounty Task Available');
    expect(inbox[0].body).toContain('bounty task');

    // Step 5: Agent B marks as read
    const readRes = await fetch(`http://localhost:${port}/api/v1/mail/read/${inbox[0].id}`, {
      method: 'PUT',
    });
    expect(readRes.status).toBe(200);

    // Step 6: Verify unread count is now 0
    const unreadRes = await fetch(`http://localhost:${port}/api/v1/mail/inbox?address=${addrB.address}&unreadOnly=true`);
    const unreadInbox = await unreadRes.json();
    expect(unreadInbox.length).toBe(0);

    // Step 7: Verify total count (including read)
    const totalRes = await fetch(`http://localhost:${port}/api/v1/mail/inbox?address=${addrB.address}`);
    const totalInbox = await totalRes.json();
    expect(totalInbox.length).toBe(1);
    expect(totalInbox[0].status).toBe('read');

    console.log(chalk.green('\n✓ End-to-end CLI workflow completed successfully!\n'));
  });

  it('should handle multiple messages in conversation', async () => {
    // Use fixed addresses
    const aliceAddr = 'agenta@local';
    const bobAddr = 'agentb@local';

    // Send multiple messages
    for (let i = 1; i <= 3; i++) {
      await fetch(`http://localhost:${port}/api/v1/mail/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fromAddress: aliceAddr,
          toAddress: bobAddr,
          subject: `Message ${i}`,
          body: `This is message number ${i}`,
        }),
      });
    }

    // Check Bob's inbox (1 from previous test + 3 new = 4)
    const inboxRes = await fetch(`http://localhost:${port}/api/v1/mail/inbox?address=${bobAddr}`);
    const inbox = await inboxRes.json();
    expect(inbox.length).toBe(4); // 1 from previous test + 3 new ones

    // Check unread count (3 are unread - 1 from previous test was marked as read)
    const unreadCount = service.getUnreadCount(bobAddr);
    expect(unreadCount).toBe(3); // 3 messages are unread
  });

  it('should return 400 for invalid requests', async () => {
    // Missing required fields
    const res1 = await fetch(`http://localhost:${port}/api/v1/mail/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromAddress: 'alice@local' }),
    });
    expect(res1.status).toBe(400);

    // Missing address param
    const res2 = await fetch(`http://localhost:${port}/api/v1/mail/inbox`);
    expect(res2.status).toBe(400);

    // Non-existent message
    const res3 = await fetch(`http://localhost:${port}/api/v1/mail/inbox/non-existent-id`);
    expect(res3.status).toBe(404);
  });
});

// Helper for colored output in tests
const chalk = {
  green: (s: string) => s,
  red: (s: string) => s,
  cyan: (s: string) => s,
  yellow: (s: string) => s,
  gray: (s: string) => s,
  bold: (s: string) => s,
};
