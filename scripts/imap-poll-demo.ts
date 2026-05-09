/**
 * IMAP Poll Integration Demo
 * 
 * This script demonstrates the complete IMAP email receive flow:
 * 1. Configure IMAP settings for gddzhaokun@163.com
 * 2. Start the IMAP poll service
 * 3. Process incoming emails and deliver to local mailboxes
 * 4. Emit events for WebSocket notification
 * 
 * Usage:
 *   bun run scripts/imap-poll-demo.ts
 * 
 * Note: Requires environment variables or .env file:
 *   IMAP_HOST=imap.163.com
 *   IMAP_PORT=993
 *   IMAP_USER=gddzhaokun@163.com
 *   IMAP_PASS=your-163-password
 */

import { Database } from '../src/lib/storage/database';
import { MessageStore } from '../src/lib/mailbox/message-store';
import { AddressManager } from '../src/lib/mailbox/address-manager';
import { EventBus, EventType } from '../src/lib/mailbox/event-bus';
import { ImapPollService } from '../src/lib/mailbox/imap-poll-service';

async function main() {
  console.log('=== IMAP Poll Service Demo ===\n');

  // Initialize components
  const db = new Database({ memory: true });
  const messageStore = new MessageStore(db);
  const addressManager = new AddressManager(db, 'local');
  const eventBus = new EventBus();

  // Register test agents
  console.log('Registering test agents...');
  const alice = addressManager.register('agent-1', 'alice');
  const bob = addressManager.register('agent-2', 'bob');
  console.log(`  Alice: ${alice.address}`);
  console.log(`  Bob: ${bob.address}\n`);

  // Subscribe to message received events
  const receivedMessages: any[] = [];
  eventBus.on(EventType.MESSAGE_RECEIVED, (data) => {
    console.log(`[Event] MESSAGE_RECEIVED: ${JSON.stringify(data)}`);
    const msg = messageStore.getById(data.messageId);
    if (msg) {
      receivedMessages.push(msg);
      console.log(`  From: ${msg.fromAddress}`);
      console.log(`  To: ${msg.toAddress}`);
      console.log(`  Subject: ${msg.subject || '(no subject)'}`);
    }
  });

  // Configure IMAP settings
  const imapConfig = {
    host: process.env.IMAP_HOST || 'imap.163.com',
    port: parseInt(process.env.IMAP_PORT || '993'),
    user: process.env.IMAP_USER || 'gddzhaokun@163.com',
    password: process.env.IMAP_PASS || '',
    tls: process.env.IMAP_TLS !== 'false',
    pollInterval: parseInt(process.env.IMAP_POLL_INTERVAL || '30000'),
    localDomain: 'local',
    onEmailReceived: (email) => {
      console.log(`[IMAP] Received: ${email.from} -> ${email.to}: ${email.subject}`);
    },
  };

  if (!imapConfig.password) {
    console.error('Error: IMAP password not configured');
    console.error('Set IMAP_PASS environment variable or add to .env file');
    console.error('\nExample .env configuration:');
    console.error('  IMAP_HOST=imap.163.com');
    console.error('  IMAP_PORT=993');
    console.error('  IMAP_USER=gddzhaokun@163.com');
    console.error('  IMAP_PASS=your-password-here');
    console.error('  IMAP_POLL_INTERVAL=30000');
    process.exit(1);
  }

  // Create and start IMAP poll service
  console.log('Configuring IMAP poll service...');
  console.log(`  Host: ${imapConfig.host}`);
  console.log(`  User: ${imapConfig.user}`);
  console.log(`  Poll Interval: ${imapConfig.pollInterval}ms`);
  
  const pollService = new ImapPollService(
    imapConfig,
    db,
    addressManager,
    messageStore,
    eventBus
  );

  // Verify connection first
  console.log('\nVerifying IMAP connection...');
  try {
    const connected = await pollService.verifyConnection();
    if (connected) {
      console.log('  ✓ IMAP connection successful');
    } else {
      console.log('  ✗ IMAP connection failed');
      console.log('  Check your credentials and network connection');
      process.exit(1);
    }
  } catch (error) {
    console.log('  ✗ IMAP connection error:', error);
    process.exit(1);
  }

  // Start polling
  console.log('\nStarting IMAP poll service...');
  pollService.start();

  // Display status periodically
  console.log('\nPolling for emails... (Press Ctrl+C to stop)\n');
  
  let pollCount = 0;
  const statusInterval = setInterval(() => {
    pollCount++;
    const status = pollService.getStatus();
    console.log(`[${new Date().toISOString()}] Poll #${pollCount} - Connected: ${status.connected}, Last UID: ${status.lastUid}`);
    
    if (receivedMessages.length > 0) {
      console.log(`  Total messages received: ${receivedMessages.length}`);
    }
  }, 10000);

  // Handle shutdown
  process.on('SIGINT', () => {
    console.log('\n\nShutting down...');
    clearInterval(statusInterval);
    pollService.stop();
    db.close();
    console.log('Done.');
    process.exit(0);
  });
}

main().catch(console.error);
