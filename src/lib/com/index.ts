/**
 * Communication Service
 * Unified interface for email communication
 */

export { AgentConfigService, type AgentConfig } from './agent-config.js';
export { SmtpService, type SmtpConfig, type SendMailOptions, type SendResult } from './smtp.js';
export { ImapService, type ImapConfig, type MailMessage, type FetchOptions } from './imap.js';
export { IdleService, type NewMailCallback } from './idle.js';

/**
 * ComService - Facade for all communication services
 */
export class ComService {
  // Services are instantiated by consumers with their own Database instance
  // This facade provides a unified entry point if needed
}

export default ComService;
