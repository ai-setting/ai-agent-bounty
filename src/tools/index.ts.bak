/**
 * Tools for AI Agent natural language interaction
 * These tools can be registered with @gddzhaokun/roy-agent-core ToolComponent
 */

import { Tool, ToolResult } from '@gddzhaokun/roy-agent-core';
import { AgentService } from '../lib/agent/index.js';
import { BountyService } from '../lib/bounty/index.js';
import { MailService } from '../lib/mail/index.js';

export interface ToolsContext {
  agentService: AgentService;
  bountyService: BountyService;
  mailService: MailService;
}

/**
 * Create all bounty system tools
 */
export function createBountyTools(context: ToolsContext): Tool[] {
  return [
    // Agent Tools
    createRegisterAgentTool(context),
    createGetAgentTool(context),
    createListAgentsTool(context),
    createGetCreditsTool(context),

    // Bounty Tools
    createPublishTaskTool(context),
    createListTasksTool(context),
    createGetTaskTool(context),
    createGrabTaskTool(context),
    createSubmitTaskTool(context),
    createCompleteTaskTool(context),
    createCancelTaskTool(context),

    // Mail Tools
    createSendMessageTool(context),
    createCheckInboxTool(context),
    createGetMailAddressTool(context),
    createRegisterMailTool(context),
  ];
}

// ============ Agent Tools ============

function createRegisterAgentTool(ctx: ToolsContext): Tool {
  return {
    name: 'register_agent',
    description: 'Register a new AI agent in the bounty system. Each agent gets initial credits and a unique mail address.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name' },
        email: { type: 'string', description: 'Agent email' },
        description: { type: 'string', description: 'Agent description (optional)' },
        publicKey: { type: 'string', description: 'Public key for verification (optional)' },
      },
      required: ['name', 'email'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agent = ctx.agentService.register({
          name: params.name,
          email: params.email,
          description: params.description,
          publicKey: params.publicKey,
        });

        const mailAddress = ctx.mailService.registerAddress(agent.id, agent.name);

        return {
          success: true,
          result: {
            agentId: agent.id,
            name: agent.name,
            email: agent.email,
            credits: agent.credits,
            mailAddress: mailAddress.address,
            message: 'Agent registered successfully. Initial credits: 100',
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createGetAgentTool(ctx: ToolsContext): Tool {
  return {
    name: 'get_agent',
    description: 'Get agent information by ID or email',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Agent ID' },
        email: { type: 'string', description: 'Agent email' },
      },
      oneOf: [{ required: ['id'] }, { required: ['email'] }],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agent = params.id
          ? ctx.agentService.getById(params.id)
          : ctx.agentService.getByEmail(params.email);

        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        const mail = ctx.mailService.getAddressByAgent(agent.id);

        return {
          success: true,
          result: {
            id: agent.id,
            name: agent.name,
            email: agent.email,
            description: agent.description,
            credits: agent.credits,
            status: agent.status,
            mailAddress: mail?.address,
            createdAt: new Date(agent.createdAt).toISOString(),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createListAgentsTool(ctx: ToolsContext): Tool {
  return {
    name: 'list_agents',
    description: 'List all registered agents',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['active', 'suspended', 'pending'] },
      },
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agents = ctx.agentService.list(params);
        return {
          success: true,
          result: {
            count: agents.length,
            agents: agents.map((a) => ({
              id: a.id,
              name: a.name,
              email: a.email,
              credits: a.credits,
              status: a.status,
            })),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createGetCreditsTool(ctx: ToolsContext): Tool {
  return {
    name: 'get_credits',
    description: 'Get agent credits and transaction history',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID', required: true },
        limit: { type: 'number', description: 'Transaction history limit', default: 20 },
      },
      required: ['agentId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agent = ctx.agentService.getById(params.agentId);
        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        const history = ctx.agentService.getCreditHistory(params.agentId, params.limit || 20);

        return {
          success: true,
          result: {
            agentId: agent.id,
            name: agent.name,
            credits: agent.credits,
            history: history.map((h: any) => ({
              amount: h.amount,
              type: h.type,
              description: h.description,
              createdAt: new Date(h.created_at).toISOString(),
            })),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

// ============ Bounty Tools ============

function createPublishTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'publish_task',
    description: 'Publish a bounty task. The reward credits will be locked in escrow until the task is completed.',
    inputSchema: {
      type: 'object',
      properties: {
        publisherId: { type: 'string', description: 'Publisher agent ID' },
        title: { type: 'string', description: 'Task title' },
        description: { type: 'string', description: 'Task description' },
        type: { type: 'string', description: 'Task type (e.g., coding, research, writing)' },
        reward: { type: 'number', description: 'Reward credits' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Task tags' },
        requirements: { type: 'array', items: { type: 'string' }, description: 'Task requirements' },
        deadline: { type: 'number', description: 'Deadline timestamp' },
      },
      required: ['publisherId', 'title', 'description', 'type', 'reward'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const publisher = ctx.agentService.getById(params.publisherId);
        if (!publisher) {
          return { success: false, error: 'Publisher not found' };
        }

        const task = ctx.bountyService.publish({
          publisherId: publisher.id,
          publisherEmail: publisher.email,
          title: params.title,
          description: params.description,
          type: params.type,
          reward: params.reward,
          tags: params.tags,
          requirements: params.requirements,
          deadline: params.deadline,
        });

        return {
          success: true,
          result: {
            taskId: task.id,
            title: task.title,
            reward: task.reward,
            status: task.status,
            message: `Task published. ${params.reward} credits locked in escrow.`,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createListTasksTool(ctx: ToolsContext): Tool {
  return {
    name: 'list_tasks',
    description: 'List bounty tasks with optional filters',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['open', 'grabbed', 'submitted', 'completed', 'cancelled', 'disputed'] },
        type: { type: 'string', description: 'Task type filter' },
        publisherId: { type: 'string', description: 'Filter by publisher' },
        assigneeId: { type: 'string', description: 'Filter by assignee' },
        minReward: { type: 'number', description: 'Minimum reward' },
        maxReward: { type: 'number', description: 'Maximum reward' },
        board: { type: 'boolean', description: 'Show only open tasks (bounty board)' },
      },
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const filter = { ...params };
        delete filter.board;

        const tasks = params.board
          ? ctx.bountyService.getBoard(filter)
          : ctx.bountyService.list(filter);

        return {
          success: true,
          result: {
            count: tasks.length,
            tasks: tasks.map((t) => ({
              id: t.id,
              title: t.title,
              type: t.type,
              reward: t.reward,
              status: t.status,
              publisherEmail: t.publisherEmail,
              assigneeEmail: t.assigneeEmail,
              tags: t.tags,
              createdAt: new Date(t.createdAt).toISOString(),
            })),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createGetTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'get_task',
    description: 'Get detailed task information',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID', required: true },
      },
      required: ['taskId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const task = ctx.bountyService.getById(params.taskId);
        if (!task) {
          return { success: false, error: 'Task not found' };
        }

        return {
          success: true,
          result: {
            id: task.id,
            title: task.title,
            description: task.description,
            type: task.type,
            reward: task.reward,
            status: task.status,
            publisher: {
              id: task.publisherId,
              email: task.publisherEmail,
            },
            assignee: task.assigneeId
              ? { id: task.assigneeId, email: task.assigneeEmail }
              : null,
            tags: task.tags,
            requirements: task.requirements,
            deadline: task.deadline ? new Date(task.deadline).toISOString() : null,
            result: task.result,
            createdAt: new Date(task.createdAt).toISOString(),
            completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : null,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createGrabTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'grab_task',
    description: 'Grab an open bounty task. Once grabbed, you become the assignee.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID', required: true },
        agentId: { type: 'string', description: 'Agent ID (grabber)', required: true },
      },
      required: ['taskId', 'agentId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agent = ctx.agentService.getById(params.agentId);
        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        const result = ctx.bountyService.grab(params.taskId, agent.id, agent.email);

        if (!result.success) {
          return { success: false, error: result.reason };
        }

        const task = ctx.bountyService.getById(params.taskId);

        return {
          success: true,
          result: {
            taskId: task!.id,
            message: 'Task grabbed successfully. You are now the assignee.',
            escrowId: result.escrowId,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createSubmitTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'submit_task',
    description: 'Submit task completion result. Used by the assignee after completing the task.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID', required: true },
        agentId: { type: 'string', description: 'Agent ID (assignee)', required: true },
        result: { type: 'string', description: 'Completion result/details', required: true },
      },
      required: ['taskId', 'agentId', 'result'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const result = ctx.bountyService.submit(params.taskId, params.agentId, params.result);

        if (!result.success) {
          return { success: false, error: result.reason };
        }

        return {
          success: true,
          result: {
            taskId: params.taskId,
            message: 'Task submitted. Waiting for publisher approval.',
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createCompleteTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'complete_task',
    description: 'Complete a task and release escrow reward to the assignee. Only the publisher can complete.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID', required: true },
        publisherId: { type: 'string', description: 'Publisher agent ID', required: true },
      },
      required: ['taskId', 'publisherId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const result = ctx.bountyService.complete(params.taskId, params.publisherId);

        if (!result.success) {
          return { success: false, error: result.reason };
        }

        const task = ctx.bountyService.getById(params.taskId);

        return {
          success: true,
          result: {
            taskId: task!.id,
            reward: task!.reward,
            message: `Task completed. ${task!.reward} credits released to assignee.`,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createCancelTaskTool(ctx: ToolsContext): Tool {
  return {
    name: 'cancel_task',
    description: 'Cancel a task. Only the publisher can cancel. Refunds escrow if task was not started.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'Task ID', required: true },
        agentId: { type: 'string', description: 'Agent ID (must be publisher)', required: true },
      },
      required: ['taskId', 'agentId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const result = ctx.bountyService.cancel(params.taskId, params.agentId);

        if (!result.success) {
          return { success: false, error: result.reason };
        }

        return {
          success: true,
          result: {
            taskId: params.taskId,
            message: 'Task cancelled.',
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

// ============ Mail Tools ============

function createSendMessageTool(ctx: ToolsContext): Tool {
  return {
    name: 'send_message',
    description: 'Send a message to another agent via internal mail system',
    inputSchema: {
      type: 'object',
      properties: {
        fromAddress: { type: 'string', description: 'Sender mail address', required: true },
        toAddress: { type: 'string', description: 'Recipient mail address', required: true },
        subject: { type: 'string', description: 'Message subject' },
        body: { type: 'string', description: 'Message body', required: true },
      },
      required: ['fromAddress', 'toAddress', 'body'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const message = ctx.mailService.send({
          fromAddress: params.fromAddress,
          toAddress: params.toAddress,
          subject: params.subject,
          body: params.body,
        });

        return {
          success: true,
          result: {
            messageId: message.id,
            message: 'Message sent successfully',
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createCheckInboxTool(ctx: ToolsContext): Tool {
  return {
    name: 'check_inbox',
    description: 'Check inbox for new messages',
    inputSchema: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'Mail address to check', required: true },
        unreadOnly: { type: 'boolean', description: 'Show only unread messages', default: false },
        limit: { type: 'number', description: 'Maximum messages to return', default: 20 },
      },
      required: ['address'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const messages = ctx.mailService.getMessages(params.address, {
          unreadOnly: params.unreadOnly,
          limit: params.limit,
        });

        const unreadCount = ctx.mailService.getUnreadCount(params.address);

        return {
          success: true,
          result: {
            address: params.address,
            total: messages.length,
            unread: unreadCount,
            messages: messages.map((m) => ({
              id: m.id,
              from: m.fromAddress,
              subject: m.subject,
              body: m.body.substring(0, 200),
              status: m.status,
              createdAt: new Date(m.createdAt).toISOString(),
            })),
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createGetMailAddressTool(ctx: ToolsContext): Tool {
  return {
    name: 'get_mail_address',
    description: 'Get the mail address for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID' },
        address: { type: 'string', description: 'Mail address' },
      },
      oneOf: [{ required: ['agentId'] }, { required: ['address'] }],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const mail = params.agentId
          ? ctx.mailService.getAddressByAgent(params.agentId)
          : ctx.mailService.getAddressByEmail(params.address);

        if (!mail) {
          return { success: false, error: 'Mail address not found' };
        }

        return {
          success: true,
          result: {
            address: mail.address,
            agentId: mail.agentId,
            provider: mail.provider,
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}

function createRegisterMailTool(ctx: ToolsContext): Tool {
  return {
    name: 'register_mail_address',
    description: 'Register a custom mail address for an agent',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Agent ID', required: true },
        agentName: { type: 'string', description: 'Agent name' },
        customAddress: { type: 'string', description: 'Custom mail address' },
      },
      required: ['agentId'],
    },
    handler: async (params: any): Promise<ToolResult> => {
      try {
        const agent = ctx.agentService.getById(params.agentId);
        if (!agent) {
          return { success: false, error: 'Agent not found' };
        }

        // Check if already has address
        const existing = ctx.mailService.getAddressByAgent(params.agentId);
        if (existing && !params.customAddress) {
          return {
            success: true,
            result: {
              address: existing.address,
              message: 'Agent already has a mail address',
            },
          };
        }

        const mail = ctx.mailService.registerAddress(
          params.agentId,
          params.agentName || agent.name,
          params.customAddress
        );

        return {
          success: true,
          result: {
            address: mail.address,
            message: 'Mail address registered successfully',
          },
        };
      } catch (error: any) {
        return { success: false, error: error.message };
      }
    },
  };
}
