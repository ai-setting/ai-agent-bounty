export interface MailboxConfig {
  domain: string;
  httpPort: number;
  websocketEnabled: boolean;
  heartbeatInterval: number;
  maxIdleTime: number;
  smtpEnabled: boolean;
  smtpInboundPort: number;
  smtpQueueInterval: number;
  databasePath: string;
}

export const defaultConfig: MailboxConfig = {
  domain: 'local',
  httpPort: 3001,
  websocketEnabled: true,
  heartbeatInterval: 30000,
  maxIdleTime: 120000,
  smtpEnabled: false,
  smtpInboundPort: 2525,
  smtpQueueInterval: 5000,
  databasePath: './data/mailbox.db',
};
