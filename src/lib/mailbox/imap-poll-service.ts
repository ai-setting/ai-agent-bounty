/**
 * IMAP Poll Service
 * Periodically polls IMAP server for new emails and delivers them to local mailboxes
 * 
 * Uses raw TLS socket with manual IMAP commands for maximum compatibility
 * with providers like 163.com that require IMAP ID command
 */

import * as tls from "tls";
import { simpleParser } from "mailparser";
import { Database } from "../storage/database";
import { MessageStore } from "./message-store";
import { AddressManager } from "./address-manager";
import { EventBus, EventType } from "./event-bus";

export interface ImapPollConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  tls: boolean;
  pollInterval: number;  // milliseconds
  localDomain: string;   // e.g., 'local' - addresses ending with @local are local
  onEmailReceived?: (email: ReceivedEmail) => void;
}

export interface ReceivedEmail {
  id: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  date: Date;
  messageId: string;  // IMAP message ID for tracking
}

export class ImapPollService {
  private pollTimer?: ReturnType<typeof setInterval>;
  private lastSeqNum: number = 0;  // Track by sequence number
  private isConnected: boolean = false;
  private imapId: string = "Foxmail";  // Client identity for ID command

  constructor(
    private config: ImapPollConfig,
    private db: Database,
    private addressManager: AddressManager,
    private messageStore: MessageStore,
    private eventBus: EventBus
  ) {}

  /**
   * Start polling IMAP server
   */
  start(): void {
    if (this.pollTimer) {
      console.log("[ImapPollService] Already running");
      return;
    }

    console.log(`[ImapPollService] Starting:`);
    console.log(`  Host: ${this.config.host}`);
    console.log(`  User: ${this.config.user}`);
    console.log(`  Poll Interval: ${this.config.pollInterval}ms`);

    // Initial poll
    this.poll();

    // Schedule periodic polling
    this.pollTimer = setInterval(() => {
      this.poll();
    }, this.config.pollInterval);
  }

  /**
   * Stop polling
   */
  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      console.log("[ImapPollService] Stopped");
    }
  }

  /**
   * Get connection status
   */
  getStatus(): { connected: boolean; lastSeqNum: number } {
    return {
      connected: this.isConnected,
      lastSeqNum: this.lastSeqNum,
    };
  }

  /**
   * Manually trigger a poll
   */
  async poll(): Promise<void> {
    try {
      const messages = await this.fetchEmails();
      for (const email of messages) {
        this.processEmail(email);
      }
    } catch (error) {
      console.error("[ImapPollService] Poll error:", error);
    }
  }

  /**
   * Fetch emails using raw TLS socket
   */
  private async fetchEmails(): Promise<ReceivedEmail[]> {
    const { host, port, user, password } = this.config;
    
    return new Promise((resolve, reject) => {
      const messages: ReceivedEmail[] = [];
      
      const conn = tls.connect(port, host, {
        rejectUnauthorized: false,
      });

      let tag = 1;
      let stage = 0;
      let buffer = "";
      let total = 0;
      
      const send = (cmd: string): void => {
        conn.write(`A${tag++} ${cmd}\r\n`);
      };

      const finish = (err?: Error): void => {
        conn.end();
        this.isConnected = false;
        if (err) reject(err);
        else resolve(messages);
      };

      conn.on("data", (chunk) => {
        buffer += chunk.toString();
        
        // Process complete lines
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Stage transitions
          if (stage === 0 && trimmed.includes("* OK")) {
            stage = 1;
            send(`LOGIN "${user}" "${password}"`);
          } else if (stage === 1 && trimmed.includes("OK LOGIN")) {
            stage = 2;
            // Send ID command (required for 163.com)
            send(`ID ("name" "${this.imapId}" "version" "7.2" "vendor" "Tencent")`);
          } else if (stage === 2 && trimmed.includes("OK ID")) {
            stage = 3;
            send('SELECT "INBOX"');
          } else if (stage === 3 && trimmed.includes("READ-WRITE")) {
            stage = 4;
            this.isConnected = true;
            
            // Extract message count from buffer
            const match = buffer.match(/(\d+) EXISTS/);
            const inboxTotal = match ? parseInt(match[1]) : 0;
            
            if (inboxTotal === 0) {
              finish();
              return;
            }
            
            console.log(`[ImapPollService] INBOX has ${inboxTotal} messages`);
            
            // Fetch messages after lastSeqNum (or last 10 for first time)
            if (this.lastSeqNum > 0) {
              const start = this.lastSeqNum + 1;
              if (start <= inboxTotal) {
                console.log(`[ImapPollService] Fetching messages ${start}:${inboxTotal}`);
                send(`FETCH ${start}:${inboxTotal} (RFC822.HEADER)`);
              } else {
                console.log(`[ImapPollService] No new messages`);
                finish();
              }
            } else {
              // First run - get last 10
              const start = Math.max(1, inboxTotal - 9);
              console.log(`[ImapPollService] Initial fetch: ${start}:${inboxTotal}`);
              send(`FETCH ${start}:${inboxTotal} (RFC822.HEADER)`);
            }
          } else if (stage === 4 && trimmed.includes("OK Fetch")) {
            stage = 5;
            // Parse all messages from buffer
            this.parseMessages(buffer, messages);
            console.log(`[ImapPollService] Parsed ${messages.length} messages`);
            this.lastSeqNum = total;  // Update lastSeqNum
            console.log(`[ImapPollService] Updated lastSeqNum to ${this.lastSeqNum}`);
            finish();
          } else if (trimmed.includes("BAD") || trimmed.includes("NO") && !trimmed.includes("NO STORE")) {
            console.log("[ImapPollService] Error:", trimmed);
            finish();
          }
        }
      });

      conn.on("error", (err) => {
        console.error("[ImapPollService] Socket error:", err.message);
        finish(err);
      });

      conn.on("close", () => {
        if (stage < 4) {
          console.log("[ImapPollService] Connection closed prematurely");
        }
      });

      // Timeout
      setTimeout(() => {
        console.log("[ImapPollService] Poll timeout");
        finish();
      }, 25000);
    });
  }

  /**
   * Parse messages from IMAP response buffer
   */
  private parseMessages(buffer: string, messages: ReceivedEmail[]): void {
    // Simple header parsing
    const fromMatch = buffer.match(/From:[^\n]+/g);
    const subjectMatch = buffer.match(/Subject:[^\n]+/g);
    const msgIdMatch = buffer.match(/Message-ID:[^\n]+/g);
    const dateMatch = buffer.match(/Date:[^\n]+/g);
    
    if (fromMatch) {
      for (let i = 0; i < fromMatch.length; i++) {
        const from = this.extractHeaderValue(fromMatch[i]);
        const to = this.extractHeaderValue(buffer.match(/To:[^\n]+/g)?.[i] || "");
        const subject = this.extractHeaderValue(subjectMatch?.[i] || "");
        const msgId = this.extractHeaderValue(msgIdMatch?.[i] || "");
        const dateStr = this.extractHeaderValue(dateMatch?.[i] || "");
        
        messages.push({
          id: msgId || `msg-${Date.now()}-${i}`,
          from: from,
          to: to,
          subject: subject,
          body: "",  // Body would need RFC822.TEXT parsing
          date: dateStr ? new Date(dateStr) : new Date(),
          messageId: msgId,
        });
      }
    }
  }

  /**
   * Extract value from header line
   */
  private extractHeaderValue(header: string): string {
    const colonIdx = header.indexOf(":");
    if (colonIdx === -1) return header;
    return header.substring(colonIdx + 1).trim();
  }

  /**
   * Process received email - deliver to local mailbox and emit event
   */
  private processEmail(email: ReceivedEmail): void {
    console.log(`[ImapPollService] Processing: ${email.from} -> ${email.to}: ${email.subject}`);

    // Check if this email is for our IMAP user
    // email.to is the external address (e.g., gddzhaokun@163.com)
    // We need to find the corresponding local address
    const imapUser = this.config.user; // e.g., gddzhaokun@163.com
    
    // Check if destination matches our IMAP user (external address)
    const isForUs = email.to.toLowerCase() === imapUser.toLowerCase();
    
    if (!isForUs) {
      console.log(`[ImapPollService] Email not for us (${email.to} != ${imapUser}), skipping`);
      return;
    }

    // Find local address by mapping external to internal
    // e.g., gddzhaokun@163.com -> gddzhaokun@local
    const localAddress = imapUser.split('@')[0] + '@' + this.config.localDomain;
    const address = this.addressManager.getByEmail(localAddress);
    
    if (!address) {
      console.log(`[ImapPollService] Local address ${localAddress} not found`);
      return;
    }

    // Store message locally with local address
    const message = this.messageStore.send({
      fromAddress: email.from,
      toAddress: localAddress,  // Use local address
      subject: email.subject,
      body: email.body,
    });

    console.log(`[ImapPollService] Stored: ${message.id} -> ${localAddress}`);

    // Emit received event
    this.eventBus.emit(EventType.MESSAGE_RECEIVED, {
      messageId: message.id,
      fromAddress: email.from,
      toAddress: localAddress,
    });

    // Call optional callback
    if (this.config.onEmailReceived) {
      this.config.onEmailReceived(email);
    }
  }

  /**
   * Verify IMAP connection
   */
  async verifyConnection(): Promise<boolean> {
    const { host, port, user, password } = this.config;
    
    return new Promise((resolve) => {
      const conn = tls.connect(port, host, {
        rejectUnauthorized: false,
      });

      let stage = 0;
      let buffer = "";
      
      const send = (cmd: string): void => {
        conn.write(`A1 ${cmd}\r\n`);
      };

      conn.on("data", (chunk) => {
        buffer += chunk.toString();
        
        const lines = buffer.split(/\r?\n/);
        for (const line of lines) {
          if (stage === 0 && line.includes("* OK")) {
            stage = 1;
            send(`LOGIN "${user}" "${password}"`);
          } else if (stage === 1 && line.includes("OK LOGIN")) {
            stage = 2;
            send(`ID ("name" "${this.imapId}" "version" "7.2" "vendor" "Tencent")`);
          } else if (stage === 2 && line.includes("OK ID")) {
            stage = 3;
            send('SELECT "INBOX"');
          } else if (stage === 3 && (line.includes("READ-WRITE") || line.includes("OK SELECT"))) {
            console.log("[ImapPollService] ✅ IMAP access verified!");
            conn.end();
            resolve(true);
          } else if (line.includes("NO") || line.includes("BAD") || line.includes("Unsafe")) {
            console.log("[ImapPollService] ❌ IMAP access denied:", line);
            conn.end();
            resolve(false);
          }
        }
      });

      conn.on("error", () => resolve(false));

      setTimeout(() => {
        conn.end();
        resolve(false);
      }, 15000);
    });
  }
}

/**
 * Default IMAP settings for 163.com
 */
export const DEFAULT_163_IMAP_CONFIG: Partial<ImapPollConfig> = {
  host: "imap.163.com",
  port: 993,
  tls: true,
  pollInterval: 30000,
};
