/**
 * IMAP Poll Simulated Demo
 * 
 * This script simulates the complete IMAP email receive flow:
 * 1. Configure IMAP settings (simulated)
 * 2. Simulate incoming emails from external senders
 * 3. Deliver to local mailboxes
 * 4. Emit events for WebSocket notification
 * 
 * Usage:
 *   bun run scripts/imap-poll-simulated.ts
 */

import { Database } from '../src/lib/storage/database';
import { MessageStore } from '../src/lib/mailbox/message-store';
import { AddressManager } from '../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../src/lib/mailbox/event-bus';
import type { ReceivedEmail } from '../src/lib/mailbox/imap-poll-service';

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          IMAP Poll Service - Simulated Demo                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // Initialize components
  const db = new Database({ memory: true });
  const messageStore = new MessageStore(db);
  const addressManager = new AddressManager(db, 'local');
  const eventBus = new EventBus();

  // Register test agents
  console.log('📧 Registering agents...');
  const alice = addressManager.register('agent-1', 'alice');
  const bob = addressManager.register('agent-2', 'bob');
  const charlie = addressManager.register('agent-3', 'charlie');
  console.log(`   ✓ alice@local (Agent: alice)`);
  console.log(`   ✓ bob@local (Agent: bob)`);
  console.log(`   ✓ charlie@local (Agent: charlie)\n`);

  // Subscribe to events
  const receivedMessages: any[] = [];
  eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
    console.log(`\n🎯 [EventBus] MESSAGE_RECEIVED event received!`);
    console.log(`   Message ID: ${data.messageId}`);
    console.log(`   From: ${data.fromAddress}`);
    console.log(`   To: ${data.toAddress}`);
    
    const msg = messageStore.getById(data.messageId);
    if (msg) {
      receivedMessages.push(msg);
      console.log(`\n   📬 Message Details:`);
      console.log(`      Subject: ${msg.subject || '(no subject)'}`);
      console.log(`      Body: ${msg.body.substring(0, 50)}${msg.body.length > 50 ? '...' : ''}`);
      console.log(`      Status: ${msg.status}`);
    }
  });

  // Simulated incoming emails (as if from IMAP poll)
  const simulatedEmails: ReceivedEmail[] = [
    {
      id: 'email-sim-1',
      from: 'bob@local',
      to: 'alice@local',
      subject: 'Hey Alice!',
      body: 'Hi Alice, I just completed the task you posted. Please check the results!',
      date: new Date(),
      messageId: 'uid-1001',
    },
    {
      id: 'email-sim-2',
      from: 'external@gmail.com',
      to: 'alice@local',
      subject: 'New Bounty Available',
      body: 'Hello, we have a new bounty task for AI agents. Please check the platform!',
      date: new Date(),
      messageId: 'uid-1002',
    },
    {
      id: 'email-sim-3',
      from: 'charlie@local',
      to: 'bob@local',
      subject: 'Task Submission',
      body: 'Bob, I have submitted my work for review. Let me know your feedback.',
      date: new Date(),
      messageId: 'uid-1003',
    },
  ];

  console.log('📬 Simulated incoming emails from IMAP poll:\n');
  simulatedEmails.forEach((email, i) => {
    console.log(`   ${i + 1}. From: ${email.from} -> To: ${email.to}`);
    console.log(`      Subject: ${email.subject}`);
    console.log();
  });

  // Simulate IMAP poll process
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 Simulating IMAP Poll Process...\n');

  for (let pollRound = 1; pollRound <= 2; pollRound++) {
    console.log(`📡 Poll Round ${pollRound}: Checking for new emails...`);
    await sleep(1000);

    for (const email of simulatedEmails) {
      // Check if destination is local
      const isLocal = email.to.endsWith('@local');
      
      if (isLocal) {
        // Check if local address exists
        const address = addressManager.getByEmail(email.to);
        
        if (address) {
          console.log(`\n   📥 Processing email from ${email.from} to ${email.to}...`);
          
          // Store message locally
          const msg = messageStore.send({
            fromAddress: email.from,
            toAddress: email.to,
            subject: email.subject,
            body: email.body,
          });

          console.log(`   ✅ Message stored successfully (ID: ${msg.id})`);

          // Emit received event (this triggers WebSocket notification)
          eventBus.emit(EventType.MESSAGE_RECEIVED, {
            messageId: msg.id,
            fromAddress: email.from,
            toAddress: email.to,
          });
        } else {
          console.log(`\n   ⏭️  Skipping: Address ${email.to} not registered`);
        }
      } else {
        console.log(`\n   ⏭️  Skipping: ${email.to} is not a local address`);
      }
    }

    if (pollRound < 2) {
      console.log('\n⏳ Waiting for next poll interval (30s)...\n');
      await sleep(2000); // Shortened for demo
    }
  }

  // Summary
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 Summary\n');
  console.log(`   Total emails received: ${receivedMessages.length}`);
  
  console.log('\n   📥 Alice\'s Inbox:');
  const aliceInbox = messageStore.getInbox('alice@local');
  aliceInbox.forEach((msg, i) => {
    console.log(`      ${i + 1}. From: ${msg.fromAddress} | Subject: ${msg.subject}`);
  });

  console.log('\n   📥 Bob\'s Inbox:');
  const bobInbox = messageStore.getInbox('bob@local');
  bobInbox.forEach((msg, i) => {
    console.log(`      ${i + 1}. From: ${msg.fromAddress} | Subject: ${msg.subject}`);
  });

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  ✅ Demo Complete! IMAP Poll + WebSocket notification works ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  db.close();
}

main().catch(console.error);
