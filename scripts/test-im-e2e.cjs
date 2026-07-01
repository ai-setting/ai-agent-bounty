// scripts/test-im-e2e.js
// End-to-end IM eventsource validation
// Runs against a local bounty server (default port 4005)
const WebSocket = require('ws');

const BASE = process.env.BASE || 'http://localhost:4005';
const WS_BASE = process.env.WS_BASE || 'ws://localhost:4005/ws';

function openClient(addr, label, collectMs = 6000) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}?address=${encodeURIComponent(addr)}`);
    const inbox = [];
    ws.on('open', () => {
      console.log(`[${label}] OPEN ${addr}`);
      resolve({ ws, inbox, label });
    });
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      console.log(`[${label}] MSG`, JSON.stringify(m));
      inbox.push(m);
    });
    ws.on('error', (e) => {
      console.error(`[${label}] ERR`, e.message);
      reject(e);
    });
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('=== IM Eventsource E2E ===');
  console.log('BASE:', BASE, 'WS_BASE:', WS_BASE);

  // 0. Health
  const h = await fetch(`${BASE}/health`).then((r) => r.json());
  console.log('Health:', h);
  if (h.status !== 'ok') throw new Error('health check failed');

  // 1. Open WS clients
  const alice = await openClient('alice@bounty.local', 'alice');
  const carol = await openClient('carol@bounty.local', 'carol');
  await sleep(300);

  // 2. HTTP POST -> push to alice
  console.log('\n--- HTTP push (bob -> alice) ---');
  const r1 = await fetch(`${BASE}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'bob@bounty.local',
      to: 'alice@bounty.local',
      content: { type: 'text', body: 'http-push-e2e' },
    }),
  });
  const m1 = await r1.json();
  console.log('POST result:', m1.id);
  await sleep(300);

  // 3. WS event=message (carol -> alice)
  console.log('\n--- WS push (carol -> alice) ---');
  carol.ws.send(JSON.stringify({
    event: 'message',
    data: {
      to: 'alice@bounty.local',
      content: { type: 'text', body: 'ws-push-e2e' },
    },
  }));
  await sleep(300);

  // 4. WS ping roundtrip
  console.log('\n--- WS ping ---');
  alice.ws.send(JSON.stringify({ event: 'ping' }));
  await sleep(300);

  // 5. Assert
  const aliceMessages = alice.inbox.filter((m) => m.event === 'message');
  const hasHttp = aliceMessages.some((m) => m.data?.content?.body === 'http-push-e2e');
  const hasWs = aliceMessages.some((m) => m.data?.content?.body === 'ws-push-e2e');
  const hasPong = alice.inbox.some((m) => m.event === 'pong');
  const hasConnected = alice.inbox.some((m) => m.event === 'connected');

  console.log('\n=== ASSERTIONS ===');
  console.log(`[${hasConnected ? 'PASS' : 'FAIL'}] connected event`);
  console.log(`[${hasHttp ? 'PASS' : 'FAIL'}] HTTP push delivered`);
  console.log(`[${hasWs ? 'PASS' : 'FAIL'}] WS push delivered`);
  console.log(`[${hasPong ? 'PASS' : 'FAIL'}] ping -> pong roundtrip`);

  alice.ws.close();
  carol.ws.close();

  const ok = hasConnected && hasHttp && hasWs && hasPong;
  console.log(ok ? '\n✅ IM E2E OK' : '\n❌ IM E2E FAILED');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('FAIL', e); process.exit(2); });