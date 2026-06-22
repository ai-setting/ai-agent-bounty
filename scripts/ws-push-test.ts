#!/usr/bin/env bun
/**
 * Test WebSocket real-time push - cleaner version
 *
 * Scenario: carol@bounty.local listens, then bob sends a new message.
 * We need to mark all existing pending messages as acked so we only
 * observe the NEW one being pushed in real time.
 */

import { IMDatabase } from '../src/im/db/index.ts';

const WS_URL = 'ws://localhost:4001/ws?address=carol@bounty.local';
const HTTP_URL = 'http://localhost:4001/messages';

async function clearPendingFor(address: string) {
  const db = new IMDatabase({ path: './data/bounty.db' });
  const all = db.getInbox(address);
  let cleared = 0;
  for (const msg of all) {
    if (msg.status === 'pending' || msg.status === 'delivered') {
      db.updateMessageStatus(msg.id, 'acked');
      cleared++;
    }
  }
  db.close();
  return cleared;
}

async function main() {
  console.log('🧹 Clearing all pending messages for carol@bounty.local...');
  const cleared = await clearPendingFor('carol@bounty.local');
  console.log(`   cleared ${cleared} messages`);

  console.log('🔌 Connecting WebSocket as carol@bounty.local...');
  const ws = new WebSocket(WS_URL);

  // Track all incoming events with a simple async iterator
  const events: any[] = [];
  let resolveNext: ((e: any) => void) | null = null;

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    events.push(data);
    if (resolveNext) {
      resolveNext(data);
      resolveNext = null;
    }
  };

  const waitForEvent = (predicate: (e: any) => boolean, timeoutMs = 5000) =>
    new Promise<any>((resolve, reject) => {
      // Check existing events first
      const existing = events.find(predicate);
      if (existing) return resolve(existing);

      const timeout = setTimeout(() => {
        resolveNext = null;
        reject(new Error(`Timeout waiting for event`));
      }, timeoutMs);

      resolveNext = (data) => {
        clearTimeout(timeout);
        resolve(data);
      };
    });

  // Wait for 'connected' event
  await waitForEvent((e) => e.event === 'connected');
  console.log('✅ WebSocket connected');
  await new Promise((r) => setTimeout(r, 200));

  // Now send a NEW message from bob to carol
  console.log('📤 Sending new HTTP message: bob -> carol...');
  const sendTs = Date.now();
  const res = await fetch(HTTP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'bob@bounty.local',
      to: 'carol@bounty.local',
      content: { type: 'text', body: `Real-time push test @ ${sendTs}` },
    }),
  });
  const sent = await res.json();
  console.log(`   HTTP send OK id=${sent.id} elapsed=${Date.now() - sendTs}ms`);

  // Wait for the real-time push
  console.log('⏳ Waiting for real-time push...');
  const pushEvent = await waitForEvent(
    (e) => e.event === 'message' && e.data.id === sent.id,
    3000
  );

  const pushLatency = Date.now() - sendTs;
  console.log(`✅ Real-time push received!`);
  console.log(`   id:      ${pushEvent.data.id}`);
  console.log(`   from:    ${pushEvent.data.from}`);
  console.log(`   to:      ${pushEvent.data.to}`);
  console.log(`   status:  ${pushEvent.data.status}`);
  console.log(`   body:    ${pushEvent.data.content.body}`);
  console.log(`   latency: ${pushLatency}ms (HTTP send → WS recv)`);

  ws.close();
  console.log('✅ WebSocket real-time push test PASSED');
}

main().catch((err) => {
  console.error('❌ Test failed:', err.message);
  process.exit(1);
});