/**
 * Bounty Server Entry Point
 * 
 * Starts the full Bounty platform server with:
 * - HTTP API (Auth + Bounty + IM)
 * - WebSocket for real-time messaging
 * 
 * Environment Variables:
 * - BOUNTY_PORT: HTTP server port (default: 4002)
 * - BOUNTY_WS_PORT: WebSocket port (default: BOUNTY_PORT + 1)
 * - BOUNTY_DB_PATH: Bounty database path (default: ./data/bounty.db)
 * - BOUNTY_IM_DB_PATH: IM database path (default: ./data/im.db)
 */

import { config } from 'dotenv';
config();

import { Database } from './src/lib/storage/database';
import { IMDatabase } from './src/im/db';
import { BountyHTTPServer } from './src/server/http';
import { BountyWebSocketServer } from './src/server/ws';

// Load configuration from environment
const HTTP_PORT = parseInt(process.env.BOUNTY_PORT || '4002');
const WS_PORT = process.env.BOUNTY_WS_PORT
  ? parseInt(process.env.BOUNTY_WS_PORT)
  : HTTP_PORT + 1;

const BOUNTY_DB_PATH = process.env.BOUNTY_DB_PATH || './data/bounty.db';
const BOUNTY_IM_DB_PATH = process.env.BOUNTY_IM_DB_PATH || './data/im.db';

async function main() {
  console.log('🚀 启动 Bounty Server...');
  console.log(`   HTTP API:  http://localhost:${HTTP_PORT}`);
  console.log(`   WebSocket: ws://localhost:${WS_PORT}/ws`);

  // Initialize databases
  const bountyDb = new Database({ path: BOUNTY_DB_PATH });
  const imDb = new IMDatabase({ path: BOUNTY_IM_DB_PATH });

  console.log(`✅ 数据库初始化完成`);
  console.log(`   Bounty DB: ${BOUNTY_DB_PATH}`);
  console.log(`   IM DB: ${BOUNTY_IM_DB_PATH}`);

  // Create and start HTTP server
  const httpServer = new BountyHTTPServer({
    imDb,
    bountyDb,
    port: HTTP_PORT,
  });

  // Create WebSocket server
  const wsServer = new BountyWebSocketServer(imDb, WS_PORT);

  // Register push callback for HTTP → WebSocket message push
  httpServer.setPushCallback((address, message) => {
    wsServer.pushMessage(address, message);
  });

  // Start servers
  await httpServer.start();
  await wsServer.start();

  console.log(`\n✅ Bounty Server 启动完成！`);
  console.log(`   HTTP API:  http://localhost:${httpServer.getPort()}`);
  console.log(`   WebSocket: ws://localhost:${wsServer.getPort()}/ws`);
  console.log(`\n   按 Ctrl+C 停止服务器\n`);

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n🛑 正在停止服务器...');
    wsServer.stop();
    httpServer.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep running
  await new Promise(() => {});
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
