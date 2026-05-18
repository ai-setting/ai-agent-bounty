/**
 * Bounty IM Server 启动脚本
 * 
 * 使用方式: bun run scripts/start-im-server.ts
 * 
 * 单端口模式: HTTP 和 WebSocket 共用同一端口
 * 
 * Environment Variables:
 * - BOUNTY_PORT: 服务器端口（HTTP + WebSocket，默认 4000）
 * - BOUNTY_DB_PATH: 数据库路径（默认 ./data/bounty.db）
 */

import { config } from 'dotenv';
config();

import { IMDatabase } from '../src/im/db/index.js';
import { BountyHTTPServer } from '../src/server/http/index.js';

const PORT = parseInt(process.env.BOUNTY_PORT || '4000', 10);
const DB_PATH = process.env.BOUNTY_DB_PATH || './data/bounty.db';

async function main() {
  console.log('🚀 启动 Bounty IM Server...');
  console.log(`   HTTP:      http://localhost:${PORT}`);
  console.log(`   WebSocket: ws://localhost:${PORT}/ws`);
  console.log(`   Health:    http://localhost:${PORT}/health`);

  // 初始化数据库
  const imDb = new IMDatabase({ path: DB_PATH });
  console.log(`✅ 数据库初始化完成: ${DB_PATH}`);

  // 启动服务器（HTTP + WebSocket 共用同一端口）
  const server = new BountyHTTPServer({
    imDb,
    port: PORT,
  });
  server.start();

  console.log(`\n✅ IM Server 启动完成！`);
  console.log(`   HTTP:      http://localhost:${server.getPort()}`);
  console.log(`   WebSocket: ws://localhost:${server.getPort()}/ws`);
  console.log(`\n   按 Ctrl+C 停止服务器\n`);

  // 处理关闭信号
  const shutdown = () => {
    console.log('\n🛑 正在停止服务器...');
    server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('❌ 启动失败:', error);
  process.exit(1);
});
