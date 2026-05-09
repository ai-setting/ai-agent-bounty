export interface SmtpOutboundConfig {
  host: string;
  port: number;
  secure: boolean;      // true for 465 (SSL), false for 587 (STARTTLS)
  username: string;
  password: string;
  fromAddress: string;  // The sender address (e.g., gddzhaokun@163.com)
  fromName?: string;    // Optional sender name
}

export interface ImapInboundConfig {
  host: string;
  port: number;
  tls: boolean;
  username: string;
  password: string;
  pollInterval: number;  // milliseconds, default 30000 (30s)
  enabled: boolean;      // whether to enable IMAP polling
}

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
  smtpOutbound?: SmtpOutboundConfig;  // Optional external SMTP for sending
  imapInbound?: ImapInboundConfig;     // Optional IMAP for receiving emails
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
