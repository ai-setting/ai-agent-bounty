/**
 * Bounty Config
 * 
 * 统一管理所有 Bounty 配置项，支持环境变量覆盖和默认值。
 * WS 和 HTTP 使用相同端口。
 * 
 * 使用方式:
 * import { bountyConfig } from './bounty-config.js';
 * 
 * const port = bountyConfig.port;
 * const wsUrl = bountyConfig.wsUrl;
 * 
 * .env 文件加载:
 * - 自动加载当前工作目录下的 .env 文件
 * - 环境变量优先于 .env 文件
 */

import { config as dotenvConfig } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

// ============ .env 加载（模块初始化时执行）============

/**
 * 加载 .env 文件到 process.env
 * 使用延迟加载确保在模块被 import 时执行
 */
let envLoaded = false;

function loadEnv(): void {
  if (envLoaded) return;

  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) {
    // dotenv returns an object describing what was loaded; we
    // intentionally stay silent here to keep the module's import
    // side-effects from polluting stdout. Callers that need to
    // verify the .env was picked up can use isEnvLoaded() below.
    dotenvConfig({ path: envPath });
  }
  envLoaded = true;
}

/**
 * Returns true once the .env file in the current working directory
 * has been read. Operators and tests use this to confirm the file
 * was actually found and parsed.
 */
export function isEnvLoaded(): boolean {
  return envLoaded;
}

// 立即加载 .env
loadEnv();

// ============ 默认值定义 ============

const DEFAULTS = {
  PORT: '4000',
  HOST: 'localhost',
  URL: 'http://localhost:4000',
  WS_URL: 'ws://localhost:4000/ws',
  DOMAIN: 'bounty.local',
  DB_PATH: './data/bounty.db',
  IM_ADDRESS: '',
  // SMTP
  SMTP_HOST: '',
  SMTP_PORT: '587',
  SMTP_SECURE: 'true',
  SMTP_FROM: '',
  SMTP_AUTH_CODE: '',
  // JWT
  JWT_SECRET: '',
} as const;

// ============ Config 类 ============

class BountyConfig {
  // ============ 基础配置 ============
  
  /** Server 端口 (HTTP + WebSocket 共用) */
  get port(): number {
    loadEnv(); // 确保 .env 已加载
    return parseInt(process.env.BOUNTY_PORT || DEFAULTS.PORT, 10);
  }
  
  /** Server 主机 */
  get host(): string {
    loadEnv();
    return process.env.BOUNTY_HOST || DEFAULTS.HOST;
  }
  
  /** Server URL (HTTP) */
  get url(): string {
    loadEnv();
    if (process.env.BOUNTY_URL) {
      return process.env.BOUNTY_URL;
    }
    return `http://${this.host}:${this.port}`;
  }
  
  /** WebSocket URL (与 HTTP 相同端口) */
  get wsUrl(): string {
    loadEnv();
    if (process.env.BOUNTY_WS_URL) {
      return process.env.BOUNTY_WS_URL;
    }
    return `ws://${this.host}:${this.port}/ws`;
  }
  
  // ============ API 配置 ============
  
  /** API Base URL */
  get apiUrl(): string {
    loadEnv();
    // 优先级（v0.5.0）：BOUNTY_API_URL > BOUNTY_SERVER_URL > default
    return process.env.BOUNTY_API_URL
      || process.env.BOUNTY_SERVER_URL
      || this.url;
  }
  
  // ============ Domain 配置 ============
  
  /** Agent 地址域名 */
  get domain(): string {
    loadEnv();
    return process.env.BOUNTY_DOMAIN || DEFAULTS.DOMAIN;
  }
  
  /** 当前 Agent 的 IM 地址 */
  get imAddress(): string {
    loadEnv();
    return process.env.BOUNTY_IM_ADDRESS || DEFAULTS.IM_ADDRESS;
  }
  
  // ============ 数据库配置 ============
  
  /** 数据库文件路径 */
  get dbPath(): string {
    loadEnv();
    return process.env.BOUNTY_DB_PATH || DEFAULTS.DB_PATH;
  }
  
  // ============ SMTP 配置 ============
  
  get smtpHost(): string {
    loadEnv();
    return process.env.SMTP_HOST || DEFAULTS.SMTP_HOST;
  }
  
  get smtpPort(): number {
    loadEnv();
    return parseInt(process.env.SMTP_PORT || DEFAULTS.SMTP_PORT, 10);
  }
  
  get smtpSecure(): boolean {
    loadEnv();
    return process.env.SMTP_SECURE !== 'false';
  }
  
  get smtpFrom(): string {
    loadEnv();
    return process.env.SMTP_FROM || DEFAULTS.SMTP_FROM;
  }
  
  get smtpAuthCode(): string {
    loadEnv();
    return process.env.SMTP_AUTH_CODE || DEFAULTS.SMTP_AUTH_CODE;
  }
  
  // ============ JWT 配置 ============
  
  get jwtSecret(): string {
    loadEnv();
    return process.env.JWT_SECRET || DEFAULTS.JWT_SECRET;
  }
  
  // ============ 辅助方法 ============
  
  /** 
   * 获取带环境变量覆盖的 IM Server URL
   * 优先级: BOUNTY_IM_SERVER_URL > BOUNTY_WS_URL > ws://localhost:PORT/ws
   */
  getImServerUrl(): string {
    loadEnv();
    if (process.env.BOUNTY_IM_SERVER_URL) {
      return process.env.BOUNTY_IM_SERVER_URL;
    }
    if (process.env.BOUNTY_WS_URL) {
      return process.env.BOUNTY_WS_URL;
    }
    return this.wsUrl;
  }
  
  /**
   * 获取 IM 地址（带域名后缀）
   */
  getImAddress(agentId: string): string {
    loadEnv();
    return `${agentId}@${this.domain}`;
  }
  
  /**
   * 强制重新加载 .env 文件
   * 用于测试或动态切换配置
   */
  reload(): void {
    envLoaded = false;
    // 清除已加载的环境变量
    Object.keys(process.env).forEach(key => {
      if (key.startsWith('BOUNTY_') || key.startsWith('SMTP_') || key === 'JWT_SECRET') {
        delete process.env[key];
      }
    });
    loadEnv();
  }
  
  /**
   * 转换为配置项数组（用于显示）
   */
  toConfigItems(): ConfigItem[] {
    loadEnv();
    return [
      { name: 'BOUNTY_PORT', envKey: 'BOUNTY_PORT', default: DEFAULTS.PORT, desc: 'Server port (HTTP + WebSocket)' },
      { name: 'BOUNTY_URL', envKey: 'BOUNTY_URL', default: DEFAULTS.URL, desc: 'Server URL (HTTP)' },
      { name: 'BOUNTY_WS_URL', envKey: 'BOUNTY_WS_URL', default: DEFAULTS.WS_URL, desc: 'WebSocket URL' },
      { name: 'BOUNTY_API_URL', envKey: 'BOUNTY_API_URL', default: DEFAULTS.URL, desc: 'API base URL' },
      { name: 'BOUNTY_DOMAIN', envKey: 'BOUNTY_DOMAIN', default: DEFAULTS.DOMAIN, desc: 'Domain for agent addresses' },
      { name: 'BOUNTY_IM_ADDRESS', envKey: 'BOUNTY_IM_ADDRESS', default: DEFAULTS.IM_ADDRESS, desc: 'Your IM address' },
      { name: 'BOUNTY_DB_PATH', envKey: 'BOUNTY_DB_PATH', default: DEFAULTS.DB_PATH, desc: 'Database file path' },
      { name: 'SMTP_HOST', envKey: 'SMTP_HOST', default: DEFAULTS.SMTP_HOST, desc: 'SMTP server host' },
      { name: 'SMTP_PORT', envKey: 'SMTP_PORT', default: DEFAULTS.SMTP_PORT, desc: 'SMTP server port' },
      { name: 'JWT_SECRET', envKey: 'JWT_SECRET', default: '(hidden)', desc: 'JWT secret' },
    ];
  }
}

// ============ 导出单例 ============

export const bountyConfig = new BountyConfig();

// ============ 类型导出 ============

export interface ConfigItem {
  name: string;
  envKey: string;
  default: string;
  desc: string;
}

// ============ 兼容旧接口 ============

// 为了向后兼容，导出旧的常量（逐步迁移）
export const CLI_PORT = bountyConfig.port;
export const CLI_HOST = bountyConfig.host;
export const CLI_SERVER_URL = bountyConfig.url;
export const CLI_WS_URL = bountyConfig.wsUrl;
export const CLI_API_BASE = bountyConfig.apiUrl;
export const CLI_DOMAIN = bountyConfig.domain;
export const CLI_DB_PATH = bountyConfig.dbPath;
export const CONFIG_ITEMS = bountyConfig.toConfigItems();

// 兼容 getEnv 函数
export function getEnv(key: string, fallback: string): string {
  loadEnv();
  return process.env[key] || fallback;
}

export function getOptionalEnv(key: string): string | undefined {
  loadEnv();
  return process.env[key];
}
