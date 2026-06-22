#!/usr/bin/env bun
/**
 * Test WebSocket real-time message push
 *
 * 1. Connect WebSocket as alice@bounty.local
 * 2. Wait for 'connected' event
 * 3. Bob sends a message via HTTP API
 * 4. Verify Alice's WebSocket receives the message
 */

const WS_URL = 'ws://localhost:4001/ws?address=alice@bounty.local';
const HTTP_URL = 'http://localhost:4001/messages';

async function testWebSocketPush() {
  console.log('🔌 Connecting WebSocket...');
  const ws = new WebSocket(WS_URL);

  const messages: any[] = [];
  let connected = false;

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      messages.push(data);
      console.log(`  ← WS recv: event=${data.event} data=${JSON.stringify(data.data).slice(0, 80)}`);

      if (data.event === 'connected') {
        connected = true;
        clearTimeout(timeout);
        resolve();
      }
    };

    ws.onerror = (err) => {
      clearTimeout(timeout);
      reject(err);
    };
  });

  if (!connected) throw new Error('Failed to connect');
  console.log('✅ WebSocket connected as alice@bounty.local');

  // Wait a bit for connection to be fully registered
  await new Promise((r) => setTimeout(r, 200));

  console.log('📤 Sending HTTP message: bob -> alice...');
  const res = await fetch(HTTP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'bob@bounty.local',
      to: 'alice@bounty.local',
      content: { type: 'text', body: 'Real-time WebSocket push test!' },
    }),
  });
  const sent = await res.json();
  console.log(`  → HTTP send OK: id=${sent.id}`);

  // Wait for the WebSocket push
  console.log('⏳ Waiting for WebSocket push event...');
  const pushEvent = await new Promise<any>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Push timeout')), 5000);
    const handler = (event: any) => {
      const data = JSON.parse(event.data);
      if (data.event === 'message') {
        clearTimeout(timeout);
        ws.removeEventListener('message', handler);
        resolve(data);
      }
    };
    ws.addEventListener('message', handler);
  });

  console.log(`✅ WebSocket push received!`);
  console.log(`   message id=${pushEvent.data.id}`);
  console.log(`   from=${pushEvent.data.from}`);
  console.log(`   status=${pushEvent.data.status}`);

  ws.close();
  console.log('✅ Test passed!');
}

testWebSocketPush().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});