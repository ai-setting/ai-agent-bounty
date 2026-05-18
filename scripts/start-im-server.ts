/**
 * Bounty IM Server 启动脚本
 * 
 * 使用方式: bun run scripts/start-im-server.ts
 * 
 * Environment Variables:
 * - BOUNTY_PORT: HTTP 端口（默认 4002）
 * - BOUNTY_WS_PORT: WebSocket 端口（默认 PORT+1）
 * - BOUNTY_IM_DB_PATH: IM 数据库路径（默认 ./data/im.db）
 */

import { config } from 'dotenv';
config();

import { IMDatabase } from '../src/im/db/index.js';
import { BountyWebSocketServer } from '../src/server/ws/index.js';
import { BountyHTTPServer } from '../src/server/http/index.js';

async function main() {
  const HTTP_PORT = parseInt(process.env.BOUNTY_PORT || '4002');
  const WS_PORT = process.env.BOUNTY_WS_PORT
    ? parseInt(process.env.BOUNTY_WS_PORT)
    : HTTP_PORT + 1;
  const IM_DB_PATH = process.env.BOUNTY_IM_DB_PATH || './data/im.db';

  console.log(`🚀 启动 Bounty IM Server...`);
  console.log(`   HTTP: http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket: ws://localhost:${WS_PORT}/ws`);

  // 初始化 IM 数据库
  const imDb = new IMDatabase({ path: IM_DB_PATH });
  console.log(`✅ IM 数据库初始化完成: ${IM_DB_PATH}`);

  // 启动 WebSocket 服务器
  const wsServer = new BountyWebSocketServer(imDb, WS_PORT);
  await wsServer.start();
  console.log(`✅ WebSocket 服务器已启动: ws://localhost:${wsServer.getPort()}/ws`);

  // 启动 HTTP 服务器（不启用 Bounty 功能，仅 IM）
  const httpServer = new BountyHTTPServer({ imDb, port: HTTP_PORT });
  await httpServer.start();
  console.log(`✅ HTTP 服务器已启动: http://localhost:${httpServer.getPort()}`);

  console.log(`\n📍 IM Server 启动完成！`);
  console.log(`   按 Ctrl+C 停止服务器\n`);

  // 处理关闭信号
  const shutdown = async () => {
    console.log('\n🛑 正在停止服务器...');
    wsServer.stop();
    httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
