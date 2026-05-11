/**
 * TDD: Bounty Prompt Hook Tests
 * 
 * RED Phase: 编写失败的测试
 * 测试 bounty-prompt-hook 的行为
 */

import { describe, it, expect } from 'bun:test';
import { BOUNTY_CAPABILITIES } from '../src/lib/mail/bounty-constants.js';

// ============================================================================
// Test: Bounty Capabilities Content
// ============================================================================

describe('Bounty Prompt Hook - Content', () => {
  // 模拟 hook execute 行为
  function executeHook(hookContext: { name: string; renderedContent: string }): void {
    if (hookContext.name !== 'default') {
      return;
    }
    hookContext.renderedContent += BOUNTY_CAPABILITIES;
  }

  it('should append bounty capabilities to default prompt', () => {
    const hookContext = {
      name: 'default',
      renderedContent: 'You are a helpful assistant.',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('Bounty 赏金平台能力');
    expect(hookContext.renderedContent).toContain('bounty publish');
    expect(hookContext.renderedContent).toContain('bounty board');
    expect(hookContext.renderedContent).toContain('bounty agent');
  });

  it('should NOT modify non-default prompts', () => {
    const hookContext = {
      name: 'coding',
      renderedContent: 'You are a coding expert.',
    };
    
    const originalContent = hookContext.renderedContent;
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toBe(originalContent);
  });

  it('should include all task management commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty publish');
    expect(hookContext.renderedContent).toContain('bounty board');
    expect(hookContext.renderedContent).toContain('bounty grab');
    expect(hookContext.renderedContent).toContain('bounty submit');
    expect(hookContext.renderedContent).toContain('bounty complete');
    expect(hookContext.renderedContent).toContain('bounty cancel');
  });

  it('should include all agent management commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty agent register');
    expect(hookContext.renderedContent).toContain('bounty agent list');
    expect(hookContext.renderedContent).toContain('bounty agent info');
    expect(hookContext.renderedContent).toContain('bounty agent credits');
  });

  it('should include all communication commands', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('bounty com send');
    expect(hookContext.renderedContent).toContain('bounty com inbox');
    expect(hookContext.renderedContent).toContain('bounty com addresses');
    expect(hookContext.renderedContent).toContain('bounty com connect');
    expect(hookContext.renderedContent).toContain('bounty com disconnect');
  });

  it('should include core concepts explanation', () => {
    const hookContext = {
      name: 'default',
      renderedContent: '',
    };
    
    executeHook(hookContext);
    
    expect(hookContext.renderedContent).toContain('Agent');
    expect(hookContext.renderedContent).toContain('Bounty Task');
    expect(hookContext.renderedContent).toContain('Credits');
    expect(hookContext.renderedContent).toContain('Escrow');
  });
});

// ============================================================================
// Test: Hook Registration Function
// ============================================================================

describe('Bounty Prompt Hook - Registration', () => {
  it('should export registerBountyPromptHook function', async () => {
    const module = await import('../src/cli/hooks/bounty-prompt-hook.js');
    expect(typeof module.registerBountyPromptHook).toBe('function');
  });

  it('should export bountyPromptHook object', async () => {
    const module = await import('../src/cli/hooks/bounty-prompt-hook.js');
    expect(module.bountyPromptHook).toBeDefined();
    expect(module.bountyPromptHook.name).toBe('bounty-prompt-hook');
  });
});
