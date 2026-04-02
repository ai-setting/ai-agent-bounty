#!/usr/bin/env node

/**
 * agent-bounty CLI
 * Command line interface for AI Agent Bounty System
 */

import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import chalk from 'chalk';
import { Database } from '../lib/storage/database.js';
import { AgentService } from '../lib/agent/index.js';
import { BountyService } from '../lib/bounty/index.js';
import { MailService } from '../lib/mail/index.js';

// Initialize services
const db = new Database({ path: './data/bounty.db' });
const agentService = new AgentService(db);
const bountyService = new BountyService(db, agentService);
const mailService = new MailService(db);

// CLI Commands
yargs(hideBin(process.argv))
  .scriptName('agent-bounty')
  .usage('$0 <command> [options]')
  .command(
    'register',
    'Register a new agent',
    (yargs) =>
      yargs
        .option('name', { alias: 'n', type: 'string', demandOption: true, description: 'Agent name' })
        .option('email', { alias: 'e', type: 'string', demandOption: true, description: 'Agent email' })
        .option('description', { alias: 'd', type: 'string', description: 'Agent description' })
        .option('public-key', { alias: 'k', type: 'string', description: 'Public key' }),
    async (argv) => {
      try {
        const agent = agentService.register({
          name: argv.name as string,
          email: argv.email as string,
          description: argv.description as string,
          publicKey: argv.publicKey as string,
        });

        // Generate mail address
        const mailAddress = mailService.registerAddress(agent.id, agent.name);

        console.log(chalk.green('✓ Agent registered successfully'));
        console.log(chalk.cyan('  ID:'), agent.id);
        console.log(chalk.cyan('  Name:'), agent.name);
        console.log(chalk.cyan('  Email:'), agent.email);
        console.log(chalk.cyan('  Credits:'), agent.credits);
        console.log(chalk.cyan('  Mail:'), mailAddress.address);
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    }
  )
  .command(
    'agent',
    'Manage agents',
    (yargs) =>
      yargs
        .command(
          'list',
          'List all agents',
          {},
          () => {
            const agents = agentService.list();
            console.log(chalk.bold('\nAgents:\n'));
            agents.forEach((agent) => {
              console.log(chalk.cyan(`  ${agent.name} (${agent.email})`));
              console.log(chalk.gray(`    ID: ${agent.id}`));
              console.log(chalk.gray(`    Credits: ${agent.credits}`));
              console.log(chalk.gray(`    Status: ${agent.status}`));
              console.log();
            });
          }
        )
        .command(
          'info',
          'Get agent info',
          (yargs) =>
            yargs.option('id', { alias: 'i', type: 'string', demandOption: true }),
          (argv) => {
            const agent = agentService.getById(argv.id as string);
            if (!agent) {
              console.error(chalk.red('Agent not found'));
              process.exit(1);
            }
            const mail = mailService.getAddressByAgent(agent.id);
            console.log(chalk.bold('\nAgent Info:\n'));
            console.log(chalk.cyan('  ID:'), agent.id);
            console.log(chalk.cyan('  Name:'), agent.name);
            console.log(chalk.cyan('  Email:'), agent.email);
            console.log(chalk.cyan('  Credits:'), agent.credits);
            console.log(chalk.cyan('  Status:'), agent.status);
            if (mail) {
              console.log(chalk.cyan('  Mail:'), mail.address);
            }
          }
        )
        .demandCommand(1)
  )
  .command(
    'publish',
    'Publish a bounty task',
    (yargs) =>
      yargs
        .option('title', { alias: 't', type: 'string', demandOption: true })
        .option('description', { alias: 'd', type: 'string', demandOption: true })
        .option('type', { alias: 'y', type: 'string', demandOption: true })
        .option('reward', { alias: 'r', type: 'number', demandOption: true })
        .option('publisher-id', { alias: 'p', type: 'string', demandOption: true })
        .option('tags', { alias: 'g', type: 'string', description: 'Comma-separated tags' })
        .option('deadline', { alias: 'l', type: 'number', description: 'Deadline timestamp' }),
    (argv) => {
      try {
        const publisher = agentService.getById(argv.publisherId as string);
        if (!publisher) {
          console.error(chalk.red('Publisher not found'));
          process.exit(1);
        }

        const task = bountyService.publish({
          title: argv.title as string,
          description: argv.description as string,
          type: argv.type as string,
          reward: argv.reward as number,
          publisherId: publisher.id,
          publisherEmail: publisher.email,
          tags: argv.tags ? (argv.tags as string).split(',') : undefined,
          deadline: argv.deadline as number,
        });

        console.log(chalk.green('✓ Task published successfully'));
        console.log(chalk.cyan('  ID:'), task.id);
        console.log(chalk.cyan('  Title:'), task.title);
        console.log(chalk.cyan('  Reward:'), task.reward);
        console.log(chalk.cyan('  Status:'), task.status);
      } catch (error: any) {
        console.error(chalk.red('✗ Error:'), error.message);
        process.exit(1);
      }
    }
  )
  .command(
    'board',
    'View bounty board',
    (yargs) =>
      yargs
        .option('type', { alias: 'y', type: 'string', description: 'Filter by type' })
        .option('status', { alias: 's', type: 'string', description: 'Filter by status' }),
    (argv) => {
      const tasks = bountyService.list({
        status: (argv.status as any) || undefined,
        type: argv.type as string,
      });

      console.log(chalk.bold(`\nBounty Board (${tasks.length} tasks):\n`));
      tasks.forEach((task) => {
        console.log(chalk.cyan(`[${task.status.toUpperCase()}] ${task.title}`));
        console.log(chalk.gray(`  ID: ${task.id}`));
        console.log(chalk.gray(`  Reward: ${task.reward}`));
        console.log(chalk.gray(`  Type: ${task.type}`));
        console.log(chalk.gray(`  Publisher: ${task.publisherEmail}`));
        if (task.assigneeEmail) {
          console.log(chalk.gray(`  Assignee: ${task.assigneeEmail}`));
        }
        console.log();
      });
    }
  )
  .command(
    'grab',
    'Grab a bounty task',
    (yargs) =>
      yargs
        .option('task-id', { alias: 't', type: 'string', demandOption: true })
        .option('agent-id', { alias: 'a', type: 'string', demandOption: true }),
    (argv) => {
      const agent = agentService.getById(argv.agentId as string);
      if (!agent) {
        console.error(chalk.red('Agent not found'));
        process.exit(1);
      }

      const result = bountyService.grab(argv.taskId as string, agent.id, agent.email);
      if (result.success) {
        console.log(chalk.green('✓ Task grabbed successfully'));
        if (result.escrowId) {
          console.log(chalk.gray(`  Escrow ID: ${result.escrowId}`));
        }
      } else {
        console.error(chalk.red('✗ Error:'), result.reason);
        process.exit(1);
      }
    }
  )
  .command(
    'complete',
    'Complete a task',
    (yargs) =>
      yargs
        .option('task-id', { alias: 't', type: 'string', demandOption: true })
        .option('publisher-id', { alias: 'p', type: 'string', demandOption: true })
        .option('result', { alias: 'r', type: 'string', description: 'Completion result' }),
    (argv) => {
      const result = bountyService.complete(argv.taskId as string, argv.publisherId as string);
      if (result.success) {
        console.log(chalk.green('✓ Task completed'));
      } else {
        console.error(chalk.red('✗ Error:'), result.reason);
        process.exit(1);
      }
    }
  )
  .command(
    'mail',
    'Mail operations',
    (yargs) =>
      yargs
        .command(
          'send',
          'Send a message',
          (yargs) =>
            yargs
              .option('from', { alias: 'f', type: 'string', demandOption: true })
              .option('to', { alias: 't', type: 'string', demandOption: true })
              .option('subject', { alias: 's', type: 'string' })
              .option('body', { alias: 'b', type: 'string', demandOption: true }),
          (argv) => {
            try {
              const message = mailService.send({
                fromAddress: argv.from as string,
                toAddress: argv.to as string,
                subject: argv.subject as string,
                body: argv.body as string,
              });
              console.log(chalk.green('✓ Message sent'));
              console.log(chalk.cyan('  ID:'), message.id);
            } catch (error: any) {
              console.error(chalk.red('✗ Error:'), error.message);
              process.exit(1);
            }
          }
        )
        .command(
          'inbox',
          'Check inbox',
          (yargs) =>
            yargs.option('address', { alias: 'a', type: 'string', demandOption: true }),
          (argv) => {
            const messages = mailService.getMessages(argv.address as string);
            console.log(chalk.bold(`\nInbox for ${argv.address} (${messages.length} messages):\n`));
            messages.forEach((msg) => {
              console.log(chalk.cyan(`[${msg.status}] ${msg.subject || '(No subject)'}`));
              console.log(chalk.gray(`  From: ${msg.fromAddress}`));
              console.log(chalk.gray(`  At: ${new Date(msg.createdAt).toLocaleString()}`));
              console.log(chalk.gray(`  Body: ${msg.body.substring(0, 100)}...`));
              console.log();
            });
          }
        )
        .command(
          'addresses',
          'List all mail addresses',
          {},
          () => {
            const addresses = mailService.listAddresses();
            console.log(chalk.bold('\nMail Addresses:\n'));
            addresses.forEach((addr) => {
              console.log(chalk.cyan(`  ${addr.address}`));
              console.log(chalk.gray(`    Agent: ${addr.agentId}`));
              console.log(chalk.gray(`    Provider: ${addr.provider}`));
              console.log();
            });
          }
        )
        .demandCommand(1)
  )
  .command(
    'credits',
    'Check agent credits',
    (yargs) =>
      yargs.option('agent-id', { alias: 'i', type: 'string', demandOption: true }),
    (argv) => {
      const agent = agentService.getById(argv.agentId as string);
      if (!agent) {
        console.error(chalk.red('Agent not found'));
        process.exit(1);
      }
      console.log(chalk.green(`Credits: ${agent.credits}`));
    }
  )
  .demandCommand(1)
  .help()
  .alias('help', 'h')
  .version('0.1.0')
  .parse();
