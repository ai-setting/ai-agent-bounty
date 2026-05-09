/**
 * Email Receive E2E Test with 163.com
 * 
 * Tests the complete email receiving flow:
 * 1. Connect to 163 IMAP with ID command
 * 2. Poll for new emails
 * 3. Store messages in local mailbox
 * 4. Emit MESSAGE_RECEIVED events
 */

import { Database } from '../src/lib/storage/database';
import { MessageStore } from '../src/lib/mailbox/message-store';
import { AddressManager } from '../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../src/lib/mailbox/event-bus';
import { ImapPollService } from '../src/lib/mailbox/imap-poll-service';

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         Email Receive E2E Test (163.com)               ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Initialize
  const db = new Database({ memory: true });
  const messageStore = new MessageStore(db);
  const addressManager = new AddressManager(db, 'local');
  const eventBus = new EventBus();

  // Register alice
  const alice = addressManager.register('agent-1', 'alice');
  console.log(`📧 Registered: ${alice.address}\n`);

  // Track events
  const events: any[] = [];
  eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
    events.push(data);
    const msg = messageStore.getById(data.messageId);
    console.log(`\n🎯 MESSAGE_RECEIVED:`);
    console.log(`   From: ${data.fromAddress}`);
    console.log(`   To: ${data.toAddress}`);
    if (msg) {
      console.log(`   Subject: ${msg.subject || '(no subject)'}`);
    }
  });

  // IMAP config
  const imapConfig = {
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    user: process.env.IMAP_USER || 'gddzhaokun@163.com',
    password: process.env.IMAP_PASS || 'KMj4hreQnnsg4NMy',
    tls: true,
    pollInterval: 5000,
    localDomain: 'local',
  };

  console.log("IMAP Configuration:");
  console.log(`   Host: ${imapConfig.host}:${imapConfig.port}`);
  console.log(`   User: ${imapConfig.user}`);
  console.log(`   Poll Interval: ${imapConfig.pollInterval}ms\n`);

  // Create poll service
  const pollService = new ImapPollService(
    imapConfig,
    db,
    addressManager,
    messageStore,
    eventBus
  );

  // Verify connection
  console.log("🔌 Verifying IMAP connection...");
  const connected = await pollService.verifyConnection();
  
  if (!connected) {
    console.error("❌ IMAP connection failed!");
    process.exit(1);
  }

  console.log("✅ IMAP verified!\n");

  // Start polling
  console.log("📡 Starting poll service...");
  console.log("   (Waiting 10s for emails...)\n");
  pollService.start();

  // Wait
  await new Promise(r => setTimeout(r, 10000));

  // Summary
  console.log("\n" + "═".repeat(64));
  console.log("\n📊 Summary\n");
  console.log(`   Events received: ${events.length}`);
  
  if (events.length > 0) {
    console.log("\n✅ SUCCESS! Emails received via IMAP!\n");
    events.forEach((e, i) => {
      const msg = messageStore.getById(e.messageId);
      if (msg) {
        console.log(`📧 #${i + 1}:`);
        console.log(`   From: ${msg.fromAddress}`);
        console.log(`   To: ${msg.toAddress}`);
        console.log(`   Subject: ${msg.subject || '(no subject)'}`);
        console.log();
      }
    });
  } else {
    console.log("⏰ No new emails (or all emails were already processed)");
    const inbox = messageStore.getInbox('alice@local');
    console.log(`   Total in alice's inbox: ${inbox.length}`);
  }

  pollService.stop();
  db.close();

  console.log("\n✅ E2E Test Complete!");
}

main().catch(console.error);
