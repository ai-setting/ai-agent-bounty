/**
 * Email Send + Receive E2E Test
 * 
 * 1. Send email TO gddzhaokun@163.com (via SMTP)
 * 2. Poll IMAP for the new email
 * 3. Store in local mailbox
 * 4. Emit MESSAGE_RECEIVED event
 */

import nodemailer from "nodemailer";
import { Database } from '../src/lib/storage/database';
import { MessageStore } from '../src/lib/mailbox/message-store';
import { AddressManager } from '../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../src/lib/mailbox/event-bus';
import { ImapPollService } from '../src/lib/mailbox/imap-poll-service';

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║      Email Send + Receive E2E Test                  ║");
  console.log("╚══════════════════════════════════════════════════════════════╝\n");

  // Initialize
  const db = new Database({ memory: true });
  const messageStore = new MessageStore(db);
  const addressManager = new AddressManager(db, 'local');
  const eventBus = new EventBus();

  // Register alice as gddzhaokun@163.com's local address
  const alice = addressManager.register('agent-1', 'gddzhaokun');
  console.log(`📧 Registered local address: ${alice.address}`);
  console.log(`   (Maps to external: gddzhaokun@163.com)\n`);

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
      console.log(`   Body: ${msg.body.substring(0, 50)}...`);
    }
  });

  // IMAP config
  const imapConfig = {
    host: 'imap.163.com',
    port: 993,
    user: 'gddzhaokun@163.com',
    password: 'KMj4hreQnnsg4NMy',
    tls: true,
    pollInterval: 3000,
    localDomain: 'local',
  };

  // Create poll service
  const pollService = new ImapPollService(
    imapConfig,
    db,
    addressManager,
    messageStore,
    eventBus
  );

  // Verify IMAP first
  console.log("🔌 Verifying IMAP connection...");
  const connected = await pollService.verifyConnection();
  if (!connected) {
    console.error("❌ IMAP connection failed!");
    process.exit(1);
  }
  console.log("✅ IMAP verified!\n");

  // Start polling
  console.log("📡 Starting poll service...\n");
  pollService.start();

  // Send email via SMTP
  console.log("📤 Sending test email via SMTP...");
  const transporter = nodemailer.createTransport({
    host: "smtp.163.com",
    port: 465,
    secure: true,
    auth: {
      user: "gddzhaokun@163.com",
      pass: "KMj4hreQnnsg4NMy",
    },
  });

  try {
    const testSubject = `Test E2E ${Date.now()}`;
    const info = await transporter.sendMail({
      from: "gddzhaokun@163.com",
      to: "gddzhaokun@163.com",  // Send to self
      subject: testSubject,
      text: `This is a test email for E2E verification.\nSent at: ${new Date().toISOString()}`,
    });
    console.log(`✅ Email sent! MessageId: ${info.messageId}`);
    console.log(`   Subject: ${testSubject}\n`);
  } catch (err: any) {
    console.error("❌ SMTP send failed:", err.message);
  }

  // Wait for poll to pick up the email
  console.log("⏳ Waiting for IMAP poll to pick up email...\n");
  await sleep(8000);

  // Summary
  console.log("\n" + "═".repeat(64));
  console.log("\n📊 Results\n");
  
  if (events.length > 0) {
    console.log("✅ SUCCESS! Email received via IMAP!\n");
    events.forEach((e, i) => {
      const msg = messageStore.getById(e.messageId);
      if (msg) {
        console.log(`📧 Email #${i + 1}:`);
        console.log(`   From: ${msg.fromAddress}`);
        console.log(`   To: ${msg.toAddress}`);
        console.log(`   Subject: ${msg.subject || '(no subject)'}`);
        console.log();
      }
    });
  } else {
    console.log("⏰ No emails received yet");
    console.log("   The email may be delayed or in spam folder.");
  }

  pollService.stop();
  db.close();

  console.log("\n✅ Test Complete!");
}

main().catch(console.error);
