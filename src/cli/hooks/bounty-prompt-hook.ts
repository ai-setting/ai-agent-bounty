/**
 * @fileoverview Bounty Prompt Hook
 * 
 * 通过 Hook 机制将 bounty 特有命令能力注入到 default agent 的 system prompt 中
 * 
 * Hook 点：prompt.after-render
 * 触发时机：在默认 prompt 渲染完成后追加 bounty 特有内容
 */

import { globalHookManager } from '@ai-setting/roy-agent-core';
import { BOUNTY_CAPABILITIES } from '../../lib/mail/bounty-constants.js';

/**
 * Bounty Prompt Hook
 */
const bountyPromptHook = {
  name: 'bounty-prompt-hook',
  priority: 100,

  async execute(ctx: { data: unknown }): Promise<void> {
    // PromptHookContext 类型
    const hookContext = ctx.data as {
      name: string;
      originalContent: string;
      renderedContent: string;
      variables: Record<string, string>;
    };

    // 只处理 default prompt
    if (hookContext.name !== 'default') {
      return;
    }

    // 追加 Bounty 特有能力
    hookContext.renderedContent += BOUNTY_CAPABILITIES;
  },
};

/**
 * 注册 Bounty Prompt Hook 到全局 HookManager
 */
export function registerBountyPromptHook(): void {
  globalHookManager.register('prompt.after-render', bountyPromptHook);
  console.log('[Bounty] Prompt hook registered');
}

// 导出 hook 对象供测试使用
export { bountyPromptHook };
