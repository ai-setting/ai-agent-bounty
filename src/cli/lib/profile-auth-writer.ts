/**
 * Profile auth writer.
 *
 * PR3 helper: auth login / refresh 都需要把服务端返回的 access_token / refresh_token /
 * expires_at 写回当前 active profile。统一抽出来，避免 5 个命令重复实现并保证校验
 * 路径一致（schema 校验交给 saveProfile）。
 *
 * 调用约定：
 * - 必须传 ProfileContext 提供的 profile（不一定有 agent_id / email，登录成功后
 *   会回填）；
 * - 如果 access_token 为空 → 抛错（调用方应已早退）；
 * - 写盘失败（saveProfile 抛错）→ 透传错误（CLI 顶层负责打印）。
 */

import { saveProfile as defaultSaveProfile, loadProfile as defaultLoadProfile } from '../config/store.js';
import type { BountyProfile } from '../config/types.js';

export interface WriteAuthInput {
  profile: BountyProfile | null;
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: number;
  agentId?: string;
  email?: string;
  loadProfileFn?: (name: string) => BountyProfile | null;
  saveProfileFn?: (profile: BountyProfile) => void;
  consoleOut?: Console['log'];
  logger?: (message: string) => void;
}

export interface WriteAuthResult {
  wroteProfile: boolean;
  profileName?: string;
}

export function writeAuthToProfile({
  profile,
  accessToken,
  refreshToken,
  expiresAt,
  agentId,
  email,
  loadProfileFn = defaultLoadProfile,
  saveProfileFn = defaultSaveProfile,
  logger,
}: WriteAuthInput): WriteAuthResult {
  if (!accessToken) {
    throw new Error('writeAuthToProfile requires a non-empty accessToken');
  }
  if (!profile) {
    // 没有 active profile 时，调用方应已经走 fallback 写 token 文件；这里直接
    // 返回（不动磁盘），保持 helper 不引入 IO 副作用。
    return { wroteProfile: false };
  }

  const current = loadProfileFn(profile.name) ?? profile;
  const updated: BountyProfile = {
    ...current,
    auth: {
      ...current.auth,
      type: 'jwt',
      access_token: accessToken,
    },
    updated_at: Math.floor(Date.now() / 1000),
  };

  if (refreshToken !== undefined && refreshToken !== null) {
    updated.auth.refresh_token = refreshToken;
  }
  if (typeof expiresAt === 'number' && expiresAt > 0) {
    updated.auth.expires_at = expiresAt;
  }
  if (agentId) updated.agent_id = agentId;
  if (email) updated.email = email;

  saveProfileFn(updated);
  logger?.(`✓ Token written to profile "${updated.name}"`);
  return { wroteProfile: true, profileName: updated.name };
}