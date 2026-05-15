// 测试 WebSocket 客户端连接
import { Database } from '../src/lib/storage/database.js';
import { IMWebSocketServer } from '../src/im/server/ws.js';

const db = new Database({ memory: true });
const wsServer = new IMWebSocketServer(db, 0);
await wsServer.start();
const port = wsServer.getPort();

console.log("WebSocket server started on port:", port);

// 客户端连接
const ws = new WebSocket(`ws://localhost:${port}/ws?address=test@localhost`);
ws.onopen = () => console.log("✅ Connected!");
ws.onerror = (e) => console.log("❌ Error:", e.type);
ws.onmessage = (e) => console.log("Message:", e.data);
ws.onclose = (e) => console.log("Closed:", e.code, e.reason);

setTimeout(() => {
  ws.close();
  wsServer.stop();
  db.close();
  process.exit(0);
}, 3000);
