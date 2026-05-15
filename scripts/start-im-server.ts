/**
 * IM Server 启动脚本
 * 使用方式: bun run scripts/start-im-server.ts
 */

import { Database } from '../src/lib/storage/database.js';
import { IMWebSocketServer } from '../src/im/server/ws.js';
import { IMHTTPServer } from '../src/im/server/http.js';

async function main() {
  const port = parseInt(process.env.IM_PORT || '3001');

  console.log(`🚀 启动 Bounty IM Server...`);
  console.log(`   HTTP: http://localhost:${port}`);
  console.log(`   WebSocket: ws://localhost:${port + 1}/ws`);

  // 初始化数据库（Database 构造函数中已自动初始化）
  const dbPath = process.env.DATABASE_PATH || './data/bounty.db';
  const db = new Database({ path: dbPath });
  console.log(`✅ 数据库初始化完成: ${dbPath}`);

  // 启动 WebSocket 服务器（与 IMServer 保持一致，使用 port+1）
  const wsServer = new IMWebSocketServer(db, port + 1);
  await wsServer.start();
  console.log(`✅ WebSocket 服务器已启动: ws://localhost:${wsServer.getPort()}/ws`);

  // 启动 HTTP 服务器（提供 REST API）
  const httpServer = new IMHTTPServer(db, port);
  await httpServer.start();
  console.log(`✅ HTTP 服务器已启动: http://localhost:${httpServer.getPort()}`);

  console.log(`\n📍 IM Server 启动完成！`);
  console.log(`   按 Ctrl+C 停止服务器\n`);

  // 处理关闭信号
  process.on('SIGINT', async () => {
    console.log('\n🛑 正在停止服务器...');
    wsServer.stop();
    httpServer.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
